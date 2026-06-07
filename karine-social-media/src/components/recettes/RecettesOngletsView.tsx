'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import type { Recipe, RecipeCategory } from '@/data/recipes';
import { RecipeCard } from './RecipeCard';

/**
 * Vue principale de la page /recettes — onglets horizontaux par
 * catégorie + grille de recettes filtrée par l'onglet actif.
 *
 * Structure :
 *   1. Titre "Idées recettes" (script coral, centré)
 *   2. Barre de recherche + icône filtres (recherche dans l'onglet)
 *   3. Onglets horizontaux scrollables (illustration aquarelle + label)
 *   4. Grille des recettes de la catégorie active (RecipeCard)
 *
 * Onglet par défaut au mount : Salades.
 *
 * Favoris : state local `Set<string>` toggleable, pas de persistance
 * BDD côté V1 (le cœur sur la tuile est purement visuel).
 */

type TabId =
  | 'salades'
  | 'sauces'
  | 'plats'
  | 'sur-le-pouce'
  | 'desserts'
  | 'boissons'
  | 'gouter'
  | 'petit-dej'
  | 'repas-fete'
  | 'tradition'
  | 'apero-dinatoire';

type Tab = {
  id: TabId;
  label: string;
  /** Chemin /recettes/onglets/X.webp (256×256 généré depuis le PNG
   *  1024×1024 source via scripts/regen-tab-icons.mjs). */
  icon: { type: 'image'; src: string } | { type: 'emoji'; value: string };
  categories: RecipeCategory[];
};

// Ordre validé avec Karine 2026-06-07 : Salades / Sauces / Plats /
// Sur le pouce / Desserts / Boissons / Goûters / Petit déj / Repas de
// fête / Tradition / Apéro dînatoire. Onglet par défaut = Salades.
const TABS: Tab[] = [
  {
    id: 'salades',
    label: 'Salades',
    icon: { type: 'image', src: '/recettes/onglets/salades.webp' },
    categories: ['salade'],
  },
  {
    id: 'sauces',
    label: 'Sauces',
    icon: { type: 'image', src: '/recettes/onglets/sauces.webp' },
    categories: ['sauce'],
  },
  {
    id: 'plats',
    label: 'Plats',
    icon: { type: 'image', src: '/recettes/onglets/plats.webp' },
    categories: ['plat'],
  },
  {
    id: 'sur-le-pouce',
    label: 'Sur le pouce',
    icon: { type: 'image', src: '/recettes/onglets/sur-le-pouce.webp' },
    categories: ['sur_le_pouce'],
  },
  {
    id: 'desserts',
    label: 'Desserts',
    icon: { type: 'image', src: '/recettes/onglets/desserts.webp' },
    categories: ['dessert'],
  },
  {
    id: 'boissons',
    label: 'Boissons',
    icon: { type: 'image', src: '/recettes/onglets/boissons.webp' },
    categories: ['boisson'],
  },
  {
    id: 'gouter',
    label: 'Goûters',
    icon: { type: 'image', src: '/recettes/onglets/gouter.webp' },
    categories: ['gouter'],
  },
  {
    id: 'petit-dej',
    label: 'Petit déj',
    icon: { type: 'image', src: '/recettes/onglets/petit-dej.webp' },
    categories: ['petit_dejeuner'],
  },
  {
    id: 'repas-fete',
    label: 'Repas de fête',
    icon: { type: 'image', src: '/recettes/onglets/repas-fete.webp' },
    categories: ['repas_fete'],
  },
  {
    id: 'tradition',
    label: 'Tradition',
    icon: { type: 'image', src: '/recettes/onglets/tradition.webp' },
    categories: ['tradition'],
  },
  {
    id: 'apero-dinatoire',
    label: 'Apéro dînatoire',
    icon: { type: 'image', src: '/recettes/onglets/apero-dinatoire.webp' },
    categories: ['aperitif'],
  },
];

/**
 * Construit la valeur CSS `mask-image` pour fondre les bords gauche/droite
 * des onglets scrollables. Le fondu n'est appliqué que si on peut
 * effectivement scroller dans la direction concernée — sinon on garde
 * le 1er/dernier onglet pleinement opaque. Fade ~36px.
 */
function buildFadeMask(left: boolean, right: boolean): string {
  const start = left ? 'transparent 0, black 36px' : 'black 0';
  const end = right
    ? 'black calc(100% - 36px), transparent 100%'
    : 'black 100%';
  return `linear-gradient(to right, ${start}, ${end})`;
}

function matchesQuery(recipe: Recipe, q: string): boolean {
  if (!q) return true;
  const haystack = [recipe.title, ...recipe.tags, ...recipe.aliments]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export function RecettesOngletsView({
  recipes,
  userHasPlan,
}: {
  recipes: Recipe[];
  userHasPlan: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('salades');
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  // Chevrons de scroll horizontal : indiquent à l'utilisatrice qu'il y
  // a plus d'onglets à voir dans une direction. Visible UNIQUEMENT si
  // on peut effectivement scroller dans cette direction.
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Recalcule la visibilité des chevrons à chaque scroll + au resize
  // (le viewport peut changer si l'utilisatrice tourne son téléphone).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(
        el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      );
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  // Scroll programmatique de ~70 % de la largeur visible → expose
  // 2-3 onglets supplémentaires par clic. On utilise scrollTo (absolu)
  // plutôt que scrollBy (relatif) : snap propre à 0 ou à scrollMax même
  // avec un scroll smooth en cours.
  function scrollBy(direction: 'left' | 'right') {
    const el = scrollerRef.current;
    if (!el) return;
    const delta = el.clientWidth * 0.7;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const target =
      direction === 'left'
        ? Math.max(0, el.scrollLeft - delta)
        : Math.min(maxScroll, el.scrollLeft + delta);
    el.scrollTo({ left: target, behavior: 'smooth' });
  }

  // Favoris : toggle in-memory.
  const toggleFavorite = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Recettes affichées : filtrées par catégorie de l'onglet actif,
  // puis par la recherche dans cet onglet uniquement (pas cross-tab).
  const activeTabDef = TABS.find((t) => t.id === activeTab)!;
  const q = query.trim().toLowerCase();
  const visibleRecipes = useMemo(() => {
    const set = new Set<RecipeCategory>(activeTabDef.categories);
    return recipes
      .filter((r) => set.has(r.category))
      .filter((r) => matchesQuery(r, q));
  }, [recipes, activeTabDef, q]);

  return (
    <div className="space-y-3">
      {/* Titre principal — script coral-dark (meilleur contraste sur le
          dégradé rose qu'un simple coral), drop-shadow subtil pour donner
          du relief sans casser l'esprit aquarelle. */}
      <h1
        className="mt-4 text-center font-script text-5xl text-coral-dark lg:text-6xl"
        style={{
          textShadow:
            '0 1px 2px rgba(255,255,255,0.6), 0 2px 4px rgba(226,120,141,0.15)',
        }}
      >
        Idées recettes
      </h1>

      {/* Barre de recherche + bouton filtres — version compacte. La
          recherche filtre UNIQUEMENT dans l'onglet courant (pas
          cross-catégorie). */}
      <div className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-coral-soft/40">
        <Search className="size-4 shrink-0 text-ink-soft" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Rechercher dans « ${activeTabDef.label} »…`}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-soft"
        />
        <button
          type="button"
          aria-label="Filtres avancés"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-coral-soft/40 text-coral-dark transition hover:bg-coral-soft/60"
        >
          <SlidersHorizontal className="size-3.5" />
        </button>
      </div>

      {/* Conteneur relatif pour positionner les chevrons gauche/droite
          en absolute par-dessus la nav scrollable. */}
      <div className="relative">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollBy('left')}
            aria-label="Voir les onglets précédents"
            className="pointer-events-auto absolute left-0 top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-coral-dark shadow-sm ring-1 ring-coral-soft/50 backdrop-blur-sm transition hover:bg-white"
          >
            <ChevronLeft className="size-4" strokeWidth={2.5} />
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollBy('right')}
            aria-label="Voir les onglets suivants"
            className="pointer-events-auto absolute right-0 top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-coral-dark shadow-sm ring-1 ring-coral-soft/50 backdrop-blur-sm transition hover:bg-white"
          >
            <ChevronRight className="size-4" strokeWidth={2.5} />
          </button>
        )}
        {/* Onglets horizontaux scrollables. Style "fondu" : pas de
            pastille blanche, l'illustration est posée directement sur
            le fond rose. Séparateurs verticaux entre onglets (mobile).
            Point coral sous le label = onglet actif. */}
        <nav
          ref={scrollerRef as React.RefObject<HTMLElement>}
          aria-label="Catégorie de recette"
          className="overflow-x-auto pb-2"
          style={{
            scrollbarWidth: 'none',
            WebkitMaskImage: buildFadeMask(canScrollLeft, canScrollRight),
            maskImage: buildFadeMask(canScrollLeft, canScrollRight),
          }}
        >
          {/* Pas de `lg:justify-center` : ça empêche scrollLeft de
              revenir à 0 dans un flex container scrollable quand le
              contenu déborde (bug WebKit/Blink). Le `lg:mx-auto` centre
              uniquement quand le contenu tient (chevrons cachés). */}
          <div className="flex w-max items-stretch gap-0 snap-x snap-mandatory lg:mx-auto lg:gap-3">
            {TABS.map((tab, i) => {
              const isActive = tab.id === activeTab;
              return (
                <div key={tab.id} className="flex items-stretch">
                  {i > 0 && (
                    <span
                      aria-hidden
                      className="mx-1 my-3 w-px self-center bg-coral-soft/50 lg:hidden"
                      style={{ height: '2.5rem' }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.id);
                      // Vide la recherche en changeant d'onglet : la
                      // requête en cours porte sur l'ancien contexte.
                      setQuery('');
                    }}
                    aria-pressed={isActive}
                    className="relative flex w-auto min-w-[5rem] shrink-0 snap-start flex-col items-center gap-1 px-2 py-2 transition active:scale-95 lg:gap-2 lg:py-3"
                  >
                    {/* Ordre : label EN HAUT, image en dessous. Inversion
                        demandée par Karine 2026-06-07. */}
                    <span
                      className={`whitespace-nowrap text-sm transition-all ${
                        isActive
                          ? 'font-bold text-coral-dark'
                          : 'font-semibold text-coral-dark/70'
                      }`}
                    >
                      {tab.label}
                    </span>
                    <span
                      className="grid size-16 place-items-center text-4xl lg:size-24"
                      aria-hidden
                    >
                      {tab.icon.type === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={tab.icon.src}
                          alt=""
                          className="size-16 object-contain lg:size-24"
                        />
                      ) : (
                        tab.icon.value
                      )}
                    </span>
                    {/* Point coral sous l'onglet actif. Toujours rendu,
                        opacity-0 quand inactif → transition douce. */}
                    <span
                      aria-hidden
                      className={`block size-1.5 rounded-full bg-coral transition-opacity ${
                        isActive ? 'opacity-100' : 'opacity-0'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
          <style>{`nav::-webkit-scrollbar { display: none; }`}</style>
        </nav>
      </div>

      {/* Grille des recettes de la catégorie active. 2 / 3 / 4 colonnes
          selon viewport. */}
      <section className="pt-2">
        {visibleRecipes.length === 0 ? (
          <p className="rounded-[var(--radius-tile)] border border-dashed border-coral-soft/60 bg-white/40 px-4 py-10 text-center text-sm text-ink-soft">
            {q
              ? `Aucun résultat pour « ${q} » dans « ${activeTabDef.label} »`
              : `Bientôt de nouvelles recettes dans « ${activeTabDef.label} »`}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visibleRecipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                isFavorite={favorites.has(recipe.id)}
                onToggleFavorite={toggleFavorite}
                userHasPlan={userHasPlan}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
