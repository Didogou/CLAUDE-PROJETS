'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Edit3, Layers, Search, X } from 'lucide-react';
import { CATEGORY_LABELS } from '@/data/recipes';
import { RecipeRowActions } from './RecipeRowActions';
import { RecipePublicToggle } from './RecipePublicToggle';
import { SeasonBadge } from './SeasonBadge';
import { NutriScoreBadge } from '@/components/recettes/NutriScoreBadge';

type SheetLite = {
  id: string;
  sheetIndex: number;
  title: string | null;
  coverImageUrl: string;
  calories: number | null;
  nutriscoreGrade: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  nutriscoreConfidence: number | null;
};

type RecipeRow = {
  id: string;
  title: string;
  category: keyof typeof CATEGORY_LABELS;
  calories: number | null;
  coverImage: string;
  isPublic: boolean;
  isSeasonal: boolean;
  status: string;
  slides: unknown[];
  sheets: SheetLite[];
};

type Score = { grade: 'A' | 'B' | 'C' | 'D' | 'E'; confidence: number };

/** Normalise pour recherche tolérante : lowercase + retire diacritiques
 *  (NFD décompose "é" en "e + ́", puis on retire les caractères de
 *  combinaison Unicode U+0300-U+036F). */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Liste admin des recettes avec barre de recherche live (filter par
 * titre, tolérant aux accents et casse). La liste vient du serveur
 * (Server Component parent fait le fetch), ce composant gère juste
 * l'UI + le filtre côté client.
 */
export function RecipesAdminList({
  recipes,
  scores,
}: {
  recipes: RecipeRow[];
  scores: Record<string, Score>;
}) {
  const [query, setQuery] = useState('');
  // Drawer "Voir les fiches" — null = fermé, sinon l'id de la recette ouverte.
  const [openSheetsRecipeId, setOpenSheetsRecipeId] = useState<string | null>(
    null,
  );

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return recipes;
    return recipes.filter((r) => normalize(r.title).includes(q));
  }, [recipes, query]);

  const openRecipe = useMemo(
    () =>
      openSheetsRecipeId
        ? (recipes.find((r) => r.id === openSheetsRecipeId) ?? null)
        : null,
    [openSheetsRecipeId, recipes],
  );

  // Échap = fermer le drawer ; body overflow lock pendant l'ouverture.
  useEffect(() => {
    if (!openSheetsRecipeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenSheetsRecipeId(null);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [openSheetsRecipeId]);

  return (
    <>
      {/* Barre de recherche : sticky en haut pour rester accessible
          en scrollant. Icône loupe à gauche + croix à droite quand
          il y a du texte (= clear rapide). */}
      <div className="sticky top-0 z-10 -mx-1 mb-3 bg-admin-bg pb-2 pt-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-admin-ink-soft" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une recette par titre…"
            className="w-full rounded-full border border-admin-border bg-white py-2 pl-10 pr-9 text-sm text-admin-ink placeholder:text-admin-ink-soft/60 focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
            aria-label="Rechercher une recette"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Effacer la recherche"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-admin-ink-soft hover:bg-admin-soft hover:text-admin-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {query && (
          <p className="mt-1 px-3 text-[0.65rem] text-admin-ink-soft">
            {filtered.length} résultat{filtered.length !== 1 ? 's' : ''} sur{' '}
            {recipes.length}
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
          {query
            ? `Aucune recette ne correspond à « ${query} ».`
            : 'Aucune recette pour l\'instant. Clique sur « Nouvelle ».'}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const score = scores[r.id];
            return (
              <li key={r.id} className="rounded-2xl bg-admin-surface p-3 shadow-sm">
                {/* Le clic sur la zone titre/image ouvre le DRAWER des
                    fiches détaillées (Q1=B), pas directement l'éditeur.
                    Bouton "Éditer la recette" dans le drawer mène vers
                    /admin/recettes/[id]. */}
                <button
                  type="button"
                  onClick={() => setOpenSheetsRecipeId(r.id)}
                  aria-label={`Voir les fiches de ${r.title}`}
                  className="block w-full text-left transition hover:opacity-80"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <p className="text-base font-semibold leading-tight text-admin-ink">
                        {r.title}
                      </p>
                      {r.isSeasonal && <SeasonBadge compact />}
                      {r.sheets.length > 1 && (
                        <span
                          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-admin-primary/10 px-1.5 py-0.5 text-[0.6rem] font-bold text-admin-primary-dark"
                          title={`${r.sheets.length} fiches détaillées`}
                        >
                          <Layers className="size-2.5" />
                          {r.sheets.length}
                        </span>
                      )}
                    </div>
                    {score && (
                      <NutriScoreInlineBadge
                        grade={score.grade}
                        confidence={score.confidence}
                      />
                    )}
                  </div>
                </button>

                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setOpenSheetsRecipeId(r.id)}
                    aria-label={`Voir les fiches de ${r.title}`}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left transition hover:opacity-80"
                  >
                    <span
                      aria-hidden
                      className="block h-16 w-16 shrink-0 rounded-xl bg-cover bg-center"
                      style={{ backgroundImage: `url(${r.coverImage})` }}
                    />
                    <p className="min-w-0 flex-1 truncate text-xs text-admin-ink-soft">
                      {CATEGORY_LABELS[r.category]} ·{' '}
                      {r.calories ? `${r.calories} kcal` : 'kcal n/a'} ·{' '}
                      {r.sheets.length} fiche{r.sheets.length !== 1 ? 's' : ''}
                    </p>
                  </button>
                  <RecipePublicToggle slug={r.id} initial={r.isPublic} />
                  <span
                    className={`hidden rounded-full px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide sm:inline-flex ${
                      r.status === 'published'
                        ? 'bg-admin-primary text-white'
                        : r.status === 'scheduled'
                          ? 'bg-tangerine text-white'
                          : 'bg-admin-soft text-admin-ink'
                    }`}
                  >
                    {r.status}
                  </span>
                  <RecipeRowActions slug={r.id} title={r.title} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* === Drawer "Voir les fiches" === */}
      {openRecipe && (
        <SheetsDrawer
          recipe={openRecipe}
          onClose={() => setOpenSheetsRecipeId(null)}
        />
      )}
    </>
  );
}

/**
 * Drawer modal qui affiche TOUTES les fiches détaillées d'une recette
 * avec leur titre COMPLET (non tronqué) + numéro + thumbnail + calories
 * + Nutri-Score. Triée par sheet_index ascendant.
 * Au-dessus : bouton "Éditer la recette" qui navigue vers /admin/recettes/[id].
 */
function SheetsDrawer({
  recipe,
  onClose,
}: {
  recipe: RecipeRow;
  onClose: () => void;
}) {
  const sortedSheets = [...recipe.sheets].sort(
    (a, b) => a.sheetIndex - b.sheetIndex,
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Fiches de ${recipe.title}`}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 md:items-center md:p-4"
    >
      <div
        className="anim-slide-up flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:max-h-[80vh] md:rounded-3xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-admin-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-admin-ink-soft">
              {sortedSheets.length} fiche{sortedSheets.length !== 1 ? 's' : ''} détaillée{sortedSheets.length !== 1 ? 's' : ''}
            </p>
            <h2 className="mt-0.5 text-lg font-bold leading-tight text-admin-ink">
              {recipe.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid size-9 shrink-0 place-items-center rounded-full text-admin-ink-soft hover:bg-admin-soft hover:text-admin-ink"
          >
            <X className="size-5" />
          </button>
        </header>

        {/* CTA éditer la recette complète */}
        <div className="border-b border-admin-border px-5 py-2.5">
          <Link
            href={`/admin/recettes/${recipe.id}`}
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-full bg-admin-primary px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-admin-primary-dark"
          >
            <Edit3 className="size-3.5" />
            Éditer cette recette
          </Link>
        </div>

        {/* Liste des fiches */}
        <ul className="flex-1 divide-y divide-admin-border overflow-y-auto">
          {sortedSheets.length === 0 ? (
            <li className="px-5 py-6 text-center text-sm italic text-admin-ink-soft">
              Aucune fiche détaillée pour le moment.
            </li>
          ) : (
            sortedSheets.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-5 py-3">
                {/* Numéro de fiche (sheet_index 0-based → affiché 1-based) */}
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-admin-soft text-sm font-bold text-admin-ink">
                  {s.sheetIndex + 1}
                </span>
                {/* Thumbnail */}
                <span
                  aria-hidden
                  className="block size-16 shrink-0 rounded-xl bg-cover bg-center"
                  style={{ backgroundImage: `url(${s.coverImageUrl})` }}
                />
                {/* Titre complet (non tronqué) + meta */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug text-admin-ink">
                    {s.title?.trim() || (
                      <span className="italic text-admin-ink-soft">
                        Sans titre
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[0.65rem] text-admin-ink-soft">
                    {s.calories ? `${s.calories} kcal · ` : ''}fiche {s.sheetIndex + 1}
                  </p>
                </div>
                {/* Nutri-Score */}
                {s.nutriscoreGrade && (
                  <div className="shrink-0">
                    <NutriScoreBadge
                      grade={s.nutriscoreGrade}
                      size="sm"
                      withLabel={false}
                    />
                  </div>
                )}
              </li>
            ))
          )}
        </ul>

        <div
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          className="bg-white"
        />
      </div>
    </div>
  );
}

function NutriScoreInlineBadge({
  grade,
  confidence,
}: {
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  confidence: number;
}) {
  const isLow = confidence < 0.5;
  return (
    <div
      className="flex shrink-0 flex-col items-center gap-0.5"
      title={`Nutri-Score ${grade} · ${Math.round(confidence * 100)} % de confiance`}
    >
      <NutriScoreBadge grade={grade} size="sm" withLabel={false} />
      <span
        className={`text-[0.6rem] font-bold ${
          isLow ? 'text-coral-dark' : 'text-admin-ink-soft'
        }`}
      >
        {Math.round(confidence * 100)}%
      </span>
    </div>
  );
}
