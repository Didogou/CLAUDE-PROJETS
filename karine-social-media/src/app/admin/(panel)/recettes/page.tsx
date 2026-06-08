import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getAllRecipesAdmin } from '@/lib/recipes';
import { CATEGORY_LABELS } from '@/data/recipes';
import { RecipeRowActions } from '@/components/admin/RecipeRowActions';
import { RecipePublicToggle } from '@/components/admin/RecipePublicToggle';
import { SeasonBadge } from '@/components/admin/SeasonBadge';
import { NutriScoreBadge } from '@/components/recettes/NutriScoreBadge';

export const dynamic = 'force-dynamic';

export default async function AdminRecettesPage() {
  const recipes = await getAllRecipesAdmin();

  // Score Nutri-Score lu directement depuis les colonnes BDD persistées
  // par persistNutriscoreForSheet (au save admin). Plus de calcul à la
  // volée → temps de chargement quasi instantané.
  const scores = new Map<
    string,
    { grade: 'A' | 'B' | 'C' | 'D' | 'E'; confidence: number }
  >();
  for (const r of recipes) {
    const sheet = r.sheets[0];
    if (!sheet?.nutriscoreGrade) continue;
    scores.set(String(r.id), {
      grade: sheet.nutriscoreGrade,
      confidence: sheet.nutriscoreConfidence ?? 0,
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">Contenu</p>
          <h2 className="font-script text-4xl text-admin-primary-dark">Recettes</h2>
        </header>
        <Link
          href="/admin/recettes/new"
          className="flex items-center gap-2 rounded-full bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark"
        >
          <Plus className="h-4 w-4" /> Nouvelle
        </Link>
      </div>

      {recipes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
          Aucune recette pour l&apos;instant. Clique sur «&nbsp;Nouvelle&nbsp;».
        </p>
      ) : (
        <ul className="space-y-2">
          {recipes.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl bg-admin-surface p-3 shadow-sm"
            >
              {/* Titre pleine largeur en haut, NON tronqué. Sur mobile
                  les titres longs se cassent sur plusieurs lignes plutôt
                  que d'être coupés par "..." — Karine voit l'intégralité. */}
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
                  {/* Badge Nutri-Score : lettre A-E + % confiance.
                      Cliquable via le Link parent → ouvre la fiche admin. */}
                  {scores.get(String(r.id)) && (
                    <NutriScoreInlineBadge
                      grade={scores.get(String(r.id))!.grade}
                      confidence={scores.get(String(r.id))!.confidence}
                    />
                  )}
                </div>
              </Link>

              {/* Ligne actions : image + meta + toggle + édition/suppr. */}
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
          ))}
        </ul>
      )}
    </div>
  );
}

/** Badge Nutri-Score pour la liste admin : layout emballage officiel
 *  (rangée A B C D E, l'active grossie) + petit pourcentage de confiance
 *  en dessous. Utilise le composant NutriScoreBadge partagé pour la
 *  cohérence visuelle avec la fiche utilisateur. */
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
