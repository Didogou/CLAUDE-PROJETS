'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Leaf,
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
  recipeScores = {},
  initialFavoritedIds = [],
  isAuthenticated = false,
}: {
  recipes: Recipe[];
  userHasPlan: boolean;
  /** Score Nutri-Score moyen PAR recette (moyenne de ses sheets enfants).
   *  Affiché sous chaque tuile RecipeCard. Optionnel. */
  recipeScores?: Record<string, { grade: 'A' | 'B' | 'C' | 'D' | 'E'; confidence: number }>;
  /** Slugs des recettes déjà favorisées par l'utilisatrice (préchargé
   *  server-side). Permet de pré-cocher les cœurs. */
  initialFavoritedIds?: string[];
  /** Pour rediriger vers /login si non-auth lors du clic favori. */
  isAuthenticated?: boolean;
}) {
  // Query params utilisés au retour depuis la page détail d'une recette :
  //  - ?cat=…       : ouvre directement l'onglet correspondant
  //  - ?highlight=… : scroll vers la card + flash visuel (UX "tu étais ici")
  const searchParams = useSearchParams();
  const catFromUrl = searchParams.get('cat');
  const highlightFromUrl = searchParams.get('highlight');
  const initialTab: TabId = (() => {
    if (!catFromUrl) return 'salades';
    const found = TABS.find((t) =>
      (t.categories as readonly string[]).includes(catFromUrl),
    );
    return found?.id ?? 'salades';
  })();
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  // Le highlight ne doit s'animer QU'UNE FOIS au retour depuis la
  // page détail. Sans ça, changer d'onglet remount la grille et
  // l'animation CSS rejoue (clignotement parasite).
  const [highlightConsumed, setHighlightConsumed] = useState(false);

  // Marque le highlight comme "consommé" après 5s (= durée animation
  // ~4.4s + marge). Empêche les re-flashs lors des remounts de grille
  // (changement d'onglet, refresh, etc.).
  useEffect(() => {
    if (!highlightFromUrl) return;
    const t = setTimeout(() => setHighlightConsumed(true), 5000);
    return () => clearTimeout(t);
  }, [highlightFromUrl]);

  // Scroll vers la card "highlight" au retour depuis la page détail.
  // On positionne la card JUSTE SOUS le bloc sticky (AppHeader + barre
  // recherche + tuiles catégories + tags toggles ≈ 16-18rem) pour
  // que l'utilisatrice voie les tags ET la card en même temps.
  // Délai 200ms : laisse le temps au DOM de monter la grille.
  useEffect(() => {
    if (!highlightFromUrl || highlightConsumed) return;
    const t = setTimeout(() => {
      const el = document.querySelector(
        `[data-recipe-id="${CSS.escape(highlightFromUrl)}"]`,
      );
      if (el && el instanceof HTMLElement) {
        const rect = el.getBoundingClientRect();
        // Calcul 100% DYNAMIQUE de l'offset sticky :
        //  1. Hauteur réelle du bloc sticky (barre+tuiles+tags) via ref
        //  2. Hauteur réelle du AppHeader via querySelector (header[role=banner])
        //  3. Air supplémentaire en REM (1.5rem = relatif à la base
        //     font-size, résiste aux changements de typo globale)
        // Aucun pixel hardcodé → résiste à tous les écrans + tous les
        // changements futurs de design tokens.
        const stickyBlockHeight =
          stickyBlockRef.current?.getBoundingClientRect().height ?? 0;
        const headerEl =
          document.querySelector('header[role="banner"], header.sticky');
        const headerHeight =
          headerEl instanceof HTMLElement
            ? headerEl.getBoundingClientRect().height
            : 0;
        // 1.5rem d'air converti dynamiquement depuis le root font-size.
        const rootFontSize = parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        );
        const airPx = 1.5 * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
        const stickyOffset = headerHeight + stickyBlockHeight + airPx;
        const targetY = rect.top + window.scrollY - stickyOffset;
        window.scrollTo({
          top: Math.max(0, targetY),
          behavior: 'smooth',
        });
      }
    }, 200);
    return () => clearTimeout(t);
  }, [highlightFromUrl, highlightConsumed]);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(initialFavoritedIds),
  );
  // Chevrons de scroll horizontal : indiquent à l'utilisatrice qu'il y
  // a plus d'onglets à voir dans une direction. Visible UNIQUEMENT si
  // on peut effectivement scroller dans cette direction.
  const scrollerRef = useRef<HTMLElement | null>(null);
  // Ref sur tout le bloc sticky (barre recherche + toggles + tuiles) +
  // ref sur le AppHeader, pour calculer dynamiquement l'offset de scroll
  // au retour depuis la page détail. Évite les pixels fixes qui
  // pèteraient sur mobile vs desktop.
  const stickyBlockRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // Compact mode : quand la page est scrollée au-delà d'un seuil, on
  // masque les images des tuiles catégorie pour ne garder que les
  // labels + la petite fée au-dessus de l'active. Ça réduit la
  // hauteur du bloc sticky et laisse plus de place au contenu.
  const [scrolledHeader, setScrolledHeader] = useState(false);
  // Filtres diététiques — persistent entre changements de catégorie
  // (le user veut le filtrage cumulatif : ex. "Sans gluten + de saison"
  // appliqué sur n'importe quel onglet).
  const [filterSeasonal, setFilterSeasonal] = useState(false);
  const [filterVegetarian, setFilterVegetarian] = useState(false);
  const [filterGlutenFree, setFilterGlutenFree] = useState(false);
  const [filterPorkFree, setFilterPorkFree] = useState(false);
  // Filtre Nutri-Score : par défaut tous les grades sont visibles.
  // L'utilisatrice peut décocher les grades qu'elle ne veut PAS voir
  // (typiquement D et E si elle cherche à manger sainement).
  const ALL_GRADES: Array<'A' | 'B' | 'C' | 'D' | 'E'> = ['A', 'B', 'C', 'D', 'E'];
  const [nutriGrades, setNutriGrades] = useState<Set<'A' | 'B' | 'C' | 'D' | 'E'>>(
    () => new Set(ALL_GRADES),
  );
  const [nutriPopoverOpen, setNutriPopoverOpen] = useState(false);
  // Nb de grades déselectionnés (= filtre actif si > 0).
  const nutriFilterActive = nutriGrades.size < 5;
  useEffect(() => {
    let rafId = 0;
    const evaluate = () => {
      // Guard : si la page n'est pas réellement scrollable (contenu
      // tient à l'écran), on force le mode non-compact. Sans ça, iOS
      // peut faire un overscroll bounce qui rétracte le menu alors
      // que c'est inutile (1-2 plats à l'écran).
      const docHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      const canScroll = docHeight > viewportHeight + 50;
      if (!canScroll) {
        setScrolledHeader(false);
        return;
      }
      const y = window.scrollY;
      // Hystérésis LARGE (200 / 50) pour éviter le flicker.
      setScrolledHeader((prev) => {
        if (!prev && y > 200) return true;
        if (prev && y < 50) return false;
        return prev;
      });
    };
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        evaluate();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    evaluate();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

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
  const router = useRouter();
  // Toggle favori avec PERSISTANCE en DB. Optimistic UI : on change
  // le state immédiatement, on rollback si le call API échoue.
  // Non-auth → redirige vers /login (retour vers /recettes après).
  const toggleFavorite = async (id: string) => {
    if (!isAuthenticated) {
      router.push(`/login?next=${encodeURIComponent('/recettes')}`);
      return;
    }
    const wasFavorited = favorites.has(id);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (wasFavorited) next.delete(id);
      else next.add(id);
      return next;
    });
    try {
      if (wasFavorited) {
        const res = await fetch(
          `/api/favorites?targetType=recipe&targetId=${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType: 'recipe', targetId: id }),
        });
        if (!res.ok) throw new Error();
      }
    } catch {
      // Rollback optimistic
      setFavorites((prev) => {
        const next = new Set(prev);
        if (wasFavorited) next.add(id);
        else next.delete(id);
        return next;
      });
    }
  };

  // Recettes affichées : filtrées par catégorie de l'onglet actif,
  // puis par la recherche dans cet onglet uniquement (pas cross-tab).
  const activeTabDef = TABS.find((t) => t.id === activeTab)!;
  const q = query.trim().toLowerCase();
  const visibleRecipes = useMemo(() => {
    const set = new Set<RecipeCategory>(activeTabDef.categories);
    return recipes
      .filter((r) => set.has(r.category))
      .filter((r) => matchesQuery(r, q))
      .filter((r) => {
        // Filtres diététiques cumulatifs (AND entre filtres).
        if (filterSeasonal && !r.isSeasonal) return false;
        if (filterVegetarian && !r.dietaryTags.isVegetarian) return false;
        if (filterGlutenFree && !r.dietaryTags.isGlutenFree) return false;
        if (filterPorkFree && !r.dietaryTags.isPorkFree) return false;
        // Filtre Nutri-Score : si actif, garde uniquement les recettes
        // dont le grade est dans la sélection. Les recettes sans score
        // restent visibles (info manquante ≠ exclusion).
        if (nutriFilterActive) {
          const score = recipeScores[r.id];
          if (score && !nutriGrades.has(score.grade)) return false;
        }
        return true;
      });
  }, [
    recipes,
    activeTabDef,
    q,
    filterSeasonal,
    filterVegetarian,
    filterGlutenFree,
    filterPorkFree,
    nutriFilterActive,
    nutriGrades,
    recipeScores,
  ]);

  return (
    <div className="pt-1">
      {/* === Bloc STICKY (figé au scroll) : barre de recherche + tuiles
          catégories + petite fée + label souligné de l'active.
          Reste collé en haut sous le AppHeader (top-14 ≈ hauteur du
          header compact). Background dégradé subtil pour rester
          lisible quand le contenu défile derrière. */}
      <div
        ref={stickyBlockRef}
        className="sticky top-14 z-20 -mx-4 space-y-3 px-4 pb-3 pt-4 sm:-mx-6 sm:px-6"
        style={{
          backgroundImage:
            'linear-gradient(180deg, rgba(255,237,232,0.95) 0%, rgba(255,237,232,0.92) 70%, rgba(255,237,232,0) 100%)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}
      >
        {/* Barre de recherche : fond blanc rond avec ombre douce
            + icône loupe coral à gauche + badges Nutri-Score (si filtre
            actif) + sliders qui ouvre le popover Nutri-Score à droite. */}
        <div className="relative flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 shadow-md ring-1 ring-coral-soft/40">
          <Search className="size-4 shrink-0 text-coral" strokeWidth={2.3} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une recette…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-soft/70"
          />
          {/* Badges discrets des grades Nutri-Score SÉLECTIONNÉS quand
              le filtre est actif. Chaque badge a une mini croix au-dessus
              pour réactiver le grade. Si tout sélectionné → rien affiché. */}
          {nutriFilterActive && (
            <div className="flex shrink-0 items-center gap-0.5">
              {ALL_GRADES.filter((g) => nutriGrades.has(g)).map((g) => (
                <NutriBadgeMini
                  key={g}
                  grade={g}
                  onRemove={() =>
                    setNutriGrades((prev) => {
                      const next = new Set(prev);
                      next.delete(g);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setNutriPopoverOpen((v) => !v)}
            aria-label="Filtrer par Nutri-Score"
            aria-expanded={nutriPopoverOpen}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wider transition ${
              nutriFilterActive
                ? 'bg-coral text-white shadow-sm'
                : 'bg-coral-soft/30 text-coral hover:bg-coral-soft/50'
            }`}
          >
            Nutri
          </button>

          {/* Popover Nutri-Score : 5 toggles A-E avec couleurs officielles.
              Click extérieur = ferme. Animation slide-down. */}
          {nutriPopoverOpen && (
            <NutriScorePopover
              grades={nutriGrades}
              onToggle={(g) =>
                setNutriGrades((prev) => {
                  const next = new Set(prev);
                  if (next.has(g)) next.delete(g);
                  else next.add(g);
                  return next;
                })
              }
              onSelectAll={() => setNutriGrades(new Set(ALL_GRADES))}
              onClose={() => setNutriPopoverOpen(false)}
            />
          )}
        </div>

        {/* Rangée de toggles diététiques. Grid 4 colonnes EGALES :
            chaque toggle prend 1/4 de la largeur disponible → reste
            toujours sur 1 seule ligne quelle que soit la taille écran.
            Labels courts pour fit en mobile étroit. */}
        <div className="grid grid-cols-4 gap-1">
          <FilterToggle
            active={filterSeasonal}
            onClick={() => setFilterSeasonal((v) => !v)}
            icon={<Leaf className="size-3" strokeWidth={2.5} />}
            label="Saison"
            activeBg="bg-sage/25"
            activeText="text-sage"
            activeRing="ring-sage"
          />
          <FilterToggle
            active={filterVegetarian}
            onClick={() => setFilterVegetarian((v) => !v)}
            icon={
              filterVegetarian ? (
                // Actif : point vert plein (= affirmation positive "je veux du végé")
                <span
                  aria-hidden
                  className="block size-2 rounded-full bg-emerald-600"
                />
              ) : (
                // Inactif : rond vide (= neutre, pas de filtre)
                <span
                  aria-hidden
                  className="block size-2 rounded-full border border-current"
                />
              )
            }
            label="Végé"
            activeBg="bg-emerald-100"
            activeText="text-emerald-700"
            activeRing="ring-emerald-400"
          />
          <FilterToggle
            active={filterGlutenFree}
            onClick={() => setFilterGlutenFree((v) => !v)}
            icon={
              filterGlutenFree ? (
                // Actif : icône interdit (= filtre "sans gluten" appliqué)
                <Ban className="size-3" strokeWidth={2.5} />
              ) : (
                // Inactif : rond vide (= neutre, pas de filtre)
                <span
                  aria-hidden
                  className="block size-2 rounded-full border border-current"
                />
              )
            }
            label="Gluten"
            activeBg="bg-amber-100"
            activeText="text-amber-700"
            activeRing="ring-amber-400"
          />
          <FilterToggle
            active={filterPorkFree}
            onClick={() => setFilterPorkFree((v) => !v)}
            icon={
              filterPorkFree ? (
                // Actif : icône interdit (= filtre "sans porc" appliqué)
                <Ban className="size-3" strokeWidth={2.5} />
              ) : (
                // Inactif : rond vide (= neutre, pas de filtre)
                <span
                  aria-hidden
                  className="block size-2 rounded-full border border-current"
                />
              )
            }
            label="Porc"
            activeBg="bg-sky-100"
            activeText="text-sky-700"
            activeRing="ring-sky-400"
          />
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
          // pt-7 = laisse passer la petite fée qui déborde au-dessus
          // de la tuile active (overflow-x: auto force overflow-y: hidden).
          // Fée à -top-5 (20px) + drop-shadow → besoin ≥ 24px d'air.
          // pb-3 = laisse passer ring + ombre + label sous la tuile.
          className="overflow-x-auto pb-3 pt-7"
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
          {/* Tuiles catégories style "cartes" (refonte 2026-06-11) :
              chaque tuile = rectangle arrondi avec fond crème, image
              aquarelle centrée. Label rose EN DESSOUS de la tuile.
              Tuile active = bordure coral épaisse autour de la carte. */}
          <div className="flex w-max items-stretch gap-2.5 snap-x snap-mandatory px-1 lg:mx-auto lg:gap-3">
            {TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={isActive}
                  className={`relative flex shrink-0 snap-start flex-col items-center transition-all duration-500 ease-in-out active:scale-95 ${
                    scrolledHeader
                      ? 'w-auto min-w-[4rem] gap-0 px-2'
                      : 'w-24 gap-1.5 lg:w-28'
                  }`}
                >
                  {/* Petite fée qui se pose en haut-gauche de la tuile
                      ACTIVE uniquement. En mode compact (scrollé),
                      elle vient au-dessus du label, plus petite. */}
                  {isActive && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src="/recettes/fee.webp"
                      alt=""
                      aria-hidden
                      className={`anim-pulse-soft pointer-events-none absolute z-10 select-none drop-shadow-sm transition-all duration-500 ease-in-out ${
                        scrolledHeader
                          ? '-left-3 -top-5 w-9'
                          : '-left-6 -top-6 w-14 lg:w-16'
                      }`}
                    />
                  )}
                  {/* Carte tuile avec image : visible UNIQUEMENT en
                      mode non-compact. Animation fade-out smooth quand
                      on scroll. */}
                  <span
                    className={`grid aspect-square w-full place-items-center overflow-hidden rounded-2xl bg-blush/30 transition-all duration-500 ease-in-out ${
                      scrolledHeader
                        ? 'pointer-events-none max-h-0 scale-0 opacity-0'
                        : `max-h-32 scale-100 opacity-100 ${
                            isActive
                              ? 'shadow-md ring-2 ring-coral'
                              : 'shadow-sm ring-1 ring-coral-soft/40'
                          }`
                    }`}
                    aria-hidden
                  >
                    {tab.icon.type === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={tab.icon.src}
                        alt=""
                        className="size-full object-contain p-1"
                      />
                    ) : (
                      <span className="text-3xl">{tab.icon.value}</span>
                    )}
                  </span>
                  {/* Label : taille augmentée en mode normal (sm/base),
                      taille mini en mode compact (xs). Soulignement
                      coral sous l'active dans les 2 modes. */}
                  <span
                    className={`whitespace-nowrap leading-tight transition-all duration-500 ease-in-out ${
                      scrolledHeader ? 'text-xs' : 'text-sm lg:text-base'
                    } ${
                      isActive
                        ? 'font-bold text-coral underline decoration-coral decoration-2 underline-offset-4'
                        : 'font-semibold text-coral-dark'
                    }`}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
          <style>{`
            nav::-webkit-scrollbar { display: none; }
            @keyframes tab-fade-in {
              from { opacity: 0; transform: translateY(0.25rem); }
              to   { opacity: 1; transform: translateY(0); }
            }
            .tab-fade-in {
              animation: tab-fade-in 240ms cubic-bezier(0.4, 0, 0.2, 1) both;
            }
            @media (prefers-reduced-motion: reduce) {
              .tab-fade-in { animation: none; }
            }
          `}</style>
        </nav>
      </div>
      </div>
      {/* === Fin bloc sticky === */}

      {/* Grille des recettes de la catégorie active. 2 / 3 / 4 colonnes
          selon viewport. key={activeTab} → remount au changement
          d'onglet, déclenche l'anim tab-fade-in (fondu doux). */}
      <section key={activeTab} className="tab-fade-in pt-3">
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
                nutriScore={recipeScores[recipe.id] ?? null}
                highlighted={
                  !highlightConsumed && recipe.id === highlightFromUrl
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Couleurs officielles Nutri-Score (palette utilisée dans NutriScoreBadge).
const NUTRI_COLORS: Record<'A' | 'B' | 'C' | 'D' | 'E', string> = {
  A: '#1e8e3e',
  B: '#85bb2f',
  C: '#fecb02',
  D: '#ef8200',
  E: '#e63312',
};

/** Mini badge Nutri-Score affiché dans la barre de recherche.
 *  Lettre colorée + petite croix dessus pour désélectionner ce grade. */
function NutriBadgeMini({
  grade,
  onRemove,
}: {
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      aria-label={`Retirer le grade ${grade} du filtre`}
      title={`Cliquer pour ne plus voir ${grade}`}
      className="group relative grid size-4 place-items-center rounded text-[0.55rem] font-extrabold text-white transition hover:scale-110"
      style={{ backgroundColor: NUTRI_COLORS[grade] }}
    >
      {grade}
      <span
        aria-hidden
        className="absolute -right-0.5 -top-0.5 grid size-2 place-items-center rounded-full bg-white text-[0.45rem] font-bold text-ink-soft opacity-0 ring-1 ring-coral-soft/40 transition group-hover:opacity-100"
      >
        ×
      </span>
    </button>
  );
}

/** Popover qui s'ouvre au clic sur Sliders. 5 toggles A-E + bouton
 *  "Tout sélectionner" pour reset rapide. Couleurs Nutri-Score officielles. */
function NutriScorePopover({
  grades,
  onToggle,
  onSelectAll,
  onClose,
}: {
  grades: Set<'A' | 'B' | 'C' | 'D' | 'E'>;
  onToggle: (g: 'A' | 'B' | 'C' | 'D' | 'E') => void;
  onSelectAll: () => void;
  onClose: () => void;
}) {
  // Click extérieur = ferme.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest('[data-nutri-popover]')) onClose();
    };
    const t = setTimeout(() => document.addEventListener('click', onClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', onClick);
    };
  }, [onClose]);

  return (
    <div
      data-nutri-popover
      className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-coral-soft/40 bg-white p-3 shadow-xl"
      style={{ animation: 'slide-down 180ms ease-out' }}
    >
      <p className="mb-2 text-xs font-bold text-ink">Filtrer par Nutri-Score</p>
      <p className="mb-2 text-[0.65rem] text-ink-soft">
        Décoche les grades que tu ne veux pas voir.
      </p>
      <div className="grid grid-cols-5 gap-1.5">
        {(['A', 'B', 'C', 'D', 'E'] as const).map((g) => {
          const active = grades.has(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => onToggle(g)}
              aria-pressed={active}
              className={`grid aspect-square place-items-center rounded-lg text-base font-extrabold text-white transition ${
                active ? 'opacity-100 ring-2 ring-offset-1' : 'opacity-25 grayscale'
              }`}
              style={{
                backgroundColor: NUTRI_COLORS[g],
                ...(active ? { boxShadow: `0 0 0 2px ${NUTRI_COLORS[g]}` } : {}),
              }}
            >
              {g}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onSelectAll}
          className="text-[0.65rem] font-semibold text-coral hover:underline"
        >
          Tout sélectionner
        </button>
        <span className="text-[0.6rem] text-ink-soft">
          {grades.size}/5 affiché{grades.size !== 1 ? 's' : ''}
        </span>
      </div>
      <style>{`
        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/**
 * Pillule de filtre toggleable. Inactive : fond blanc + ring coral léger.
 * Active : couleurs spécifiques au tag (sage/emerald/amber/sky).
 */
function FilterToggle({
  active,
  onClick,
  icon,
  label,
  activeBg,
  activeText,
  activeRing,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  activeBg: string;
  activeText: string;
  activeRing: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full min-w-0 items-center justify-center gap-0.5 rounded-full px-1 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider ring-1 transition ${
        active
          ? `${activeBg} ${activeText} ${activeRing} shadow-sm`
          : 'bg-white/80 text-coral-dark/70 ring-coral-soft/40 hover:bg-white'
      }`}
    >
      <span className="grid size-3 shrink-0 place-items-center text-[0.55rem]">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
