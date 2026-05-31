import Link from 'next/link';
import { ChefHat, ClipboardList, Leaf, Sparkles, Users, TrendingUp } from 'lucide-react';
import { getAllRecipesAdmin } from '@/lib/recipes';
import { RecipeRowActions } from '@/components/admin/RecipeRowActions';
import { SeasonBadge } from '@/components/admin/SeasonBadge';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const recipes = await getAllRecipesAdmin();
  const published = recipes.filter((r) => r.status === 'published').length;
  const drafts = recipes.filter((r) => r.status === 'draft').length;

  // TODO : remplacer par de vraies métriques (abonnés/MRR) une fois Stripe branché
  const subscribers = 0;
  const mrr = 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Bienvenue
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">Tableau de bord</h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Vue d&apos;ensemble de votre activité.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Users} label="Abonnés actifs" value={subscribers} hint="à connecter à Stripe" />
        <Kpi icon={TrendingUp} label="MRR (€/mois)" value={mrr} hint="à connecter à Stripe" />
        <Kpi icon={ChefHat} label="Recettes publiées" value={published} hint={drafts > 0 ? `+${drafts} brouillon(s)` : 'à jour'} />
        <Kpi icon={Sparkles} label="Contenus" value={recipes.length} hint="recettes au total" />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-admin-ink-soft">
          Accès rapides
        </h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <QuickLink href="/admin/recettes" icon={ChefHat} label="Recettes" />
          <QuickLink href="/admin/menus" icon={ClipboardList} label="Menus" />
          <QuickLink href="/admin/conseils" icon={Leaf} label="Conseils" />
          <QuickLink href="/admin/astuces" icon={Sparkles} label="Astuces" />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-admin-ink-soft">
          Derniers contenus
        </h3>
        {recipes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-admin-border bg-admin-surface px-4 py-8 text-center text-admin-ink-soft">
            Aucun contenu pour l&apos;instant.{' '}
            <Link href="/admin/recettes/new" className="font-semibold text-admin-primary hover:underline">
              Créer une recette
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-admin-border overflow-hidden rounded-xl bg-admin-surface shadow-sm">
            {recipes.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <span
                  aria-hidden
                  className="block h-12 w-12 shrink-0 rounded-lg bg-cover bg-center"
                  style={{ backgroundImage: `url(${r.coverImage})` }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-admin-ink">{r.title}</p>
                    {r.isSeasonal && <SeasonBadge compact />}
                  </div>
                  <p className="text-xs text-admin-ink-soft">
                    {r.calories ? `${r.calories} kcal` : 'kcal n/a'} · {r.slides.length} slides
                  </p>
                </div>
                <span
                  className={`hidden rounded-full px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide sm:inline-flex ${
                    r.status === 'published'
                      ? 'bg-admin-primary text-white'
                      : 'bg-admin-soft text-admin-ink'
                  }`}
                >
                  {r.status}
                </span>
                <RecipeRowActions slug={r.id} title={r.title} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof ChefHat;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-xl bg-admin-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-admin-ink-soft">
        <Icon className="h-4 w-4 text-admin-primary" />
        {label}
      </div>
      <p className="text-2xl font-extrabold text-admin-primary-dark">{value}</p>
      <p className="mt-0.5 text-[0.7rem] text-admin-ink-soft">{hint}</p>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof ChefHat;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-xl bg-admin-surface px-4 py-3 text-sm font-semibold text-admin-ink shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <Icon className="h-5 w-5 text-admin-primary" />
      {label}
    </Link>
  );
}
