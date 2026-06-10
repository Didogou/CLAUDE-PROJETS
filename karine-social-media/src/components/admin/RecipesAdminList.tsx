'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { CATEGORY_LABELS } from '@/data/recipes';
import { RecipeRowActions } from './RecipeRowActions';
import { RecipePublicToggle } from './RecipePublicToggle';
import { SeasonBadge } from './SeasonBadge';
import { NutriScoreBadge } from '@/components/recettes/NutriScoreBadge';

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

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return recipes;
    return recipes.filter((r) => normalize(r.title).includes(q));
  }, [recipes, query]);

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
                <Link
                  href={`/admin/recettes/${r.id}`}
                  aria-label={`Modifier ${r.title}`}
                  className="block transition hover:opacity-80"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <p className="text-base font-semibold leading-tight text-admin-ink">
                        {r.title}
                      </p>
                      {r.isSeasonal && <SeasonBadge compact />}
                    </div>
                    {score && (
                      <NutriScoreInlineBadge
                        grade={score.grade}
                        confidence={score.confidence}
                      />
                    )}
                  </div>
                </Link>

                <div className="mt-2 flex items-center gap-3">
                  <Link
                    href={`/admin/recettes/${r.id}`}
                    aria-label={`Modifier ${r.title}`}
                    className="flex min-w-0 flex-1 items-center gap-3 transition hover:opacity-80"
                  >
                    <span
                      aria-hidden
                      className="block h-16 w-16 shrink-0 rounded-xl bg-cover bg-center"
                      style={{ backgroundImage: `url(${r.coverImage})` }}
                    />
                    <p className="min-w-0 flex-1 truncate text-xs text-admin-ink-soft">
                      {CATEGORY_LABELS[r.category]} ·{' '}
                      {r.calories ? `${r.calories} kcal` : 'kcal n/a'} ·{' '}
                      {r.slides.length} slides
                    </p>
                  </Link>
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
    </>
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
