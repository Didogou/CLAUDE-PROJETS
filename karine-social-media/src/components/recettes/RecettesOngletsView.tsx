'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import type { Recipe, RecipeCategory } from '@/data/recipes';

/**
 * Vue recettes V2 — POC validé sur maquette Karine 2026-06-07.
 *
 * Structure :
 *   1. Titre "Idées recettes" (script coral, centré)
 *   2. Barre de recherche + icône filtres
 *   3. Onglets horizontaux scrollables (tuile carrée icône + label)
 *      → Salades, Plats, Desserts, Boissons, Snacks
 *   4. Section "Collections Karine" (groupes thématiques)
 *      → Grille 2 colonnes de cartes (image + nom + sous-titre + chevron)
 *
 * À itérer avec Karine :
 *  - icônes des onglets : actuellement emoji placeholder, à remplacer
 *    par illustrations aquarelle Karine (assets-source/06_ICONES_ET_UI)
 *  - images des collections : idem
 *  - logique click onglet : actuellement "filtre visuel" du POC, à
 *    décider — page dédiée ou filtre des Collections affichées ?
 *  - logique click collection : actuellement Link désactivé, à brancher
 *    sur une page collection ou un filtre Recipes
 */

type TabId =
  | 'salades'
  | 'entrees'
  | 'plats'
  | 'sauces'
  | 'desserts'
  | 'boissons'
  | 'gouter'
  | 'sur-le-pouce';

type Tab = {
  id: TabId;
  label: string;
  /** Soit une image (chemin /recettes/onglets/X.webp), soit un emoji
   *  placeholder en attendant l'illustration Karine.
   *  Mémoire format : 1024×1024 PNG transparent en source, converti
   *  en WebP 256×256 via scripts/regen-tab-icons.mjs. */
  icon: { type: 'image'; src: string } | { type: 'emoji'; value: string };
  categories: RecipeCategory[];
};

const TABS: Tab[] = [
  {
    id: 'salades',
    label: 'Salades',
    icon: { type: 'image', src: '/recettes/onglets/salades.webp' },
    categories: ['salade'],
  },
  {
    id: 'entrees',
    label: 'Entrées',
    icon: { type: 'image', src: '/recettes/onglets/entrees.webp' },
    categories: ['entree', 'aperitif'],
  },
  {
    id: 'plats',
    label: 'Plats',
    icon: { type: 'image', src: '/recettes/onglets/plats.webp' },
    categories: ['plat'],
  },
  {
    id: 'sauces',
    label: 'Sauces',
    icon: { type: 'image', src: '/recettes/onglets/sauces.webp' },
    categories: ['sauce'],
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
    label: 'Goûter',
    icon: { type: 'image', src: '/recettes/onglets/gouter.webp' },
    categories: ['gouter'],
  },
  {
    id: 'sur-le-pouce',
    label: 'Sur le pouce',
    // Emoji placeholder en attendant que Karine livre sur-le-pouce.png
    icon: { type: 'emoji', value: '🥪' },
    categories: ['sur_le_pouce'],
  },
];

type Collection = {
  id: string;
  name: string;
  subtitle: string;
  emoji: string; // placeholder — à remplacer par image
};

const COLLECTIONS: Collection[] = [
  { id: 'cerises', name: 'Cerises', subtitle: 'dans tous leurs états', emoji: '🍒' },
  { id: 'aubergines', name: 'Aubergines', subtitle: 'healthy', emoji: '🍆' },
  { id: 'crevettes', name: 'Crevettes', subtitle: 'à la fête', emoji: '🦐' },
  { id: 'oeufs', name: 'Œufs', subtitle: 'cocotte', emoji: '🍳' },
  { id: 'cookies', name: 'Cookies', subtitle: 'gourmands', emoji: '🍪' },
  { id: 'pains-pita', name: 'Pains pita', subtitle: 'du monde', emoji: '🥙' },
  { id: 'tomates', name: 'Tomates', subtitle: 'farcies', emoji: '🍅' },
  { id: 'salades-pates', name: 'Salades', subtitle: 'de pâtes', emoji: '🥗' },
];

export function RecettesOngletsView({
  recipes,
  userHasPlan,
}: {
  recipes: Recipe[];
  userHasPlan: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('salades');
  const [query, setQuery] = useState('');
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
  // 2-3 onglets supplémentaires par clic.
  function scrollBy(direction: 'left' | 'right') {
    const el = scrollerRef.current;
    if (!el) return;
    const delta = el.clientWidth * 0.7;
    el.scrollBy({
      left: direction === 'left' ? -delta : delta,
      behavior: 'smooth',
    });
  }

  // Compteur par onglet (utile pour l'affordance visuelle)
  const countByTab = useMemo(() => {
    const map: Record<TabId, number> = {
      salades: 0,
      entrees: 0,
      plats: 0,
      sauces: 0,
      desserts: 0,
      boissons: 0,
      gouter: 0,
      'sur-le-pouce': 0,
    };
    for (const tab of TABS) {
      const set = new Set<RecipeCategory>(tab.categories);
      map[tab.id] = recipes.filter((r) => set.has(r.category)).length;
    }
    return map;
  }, [recipes]);

  // Filtre Collections selon onglet actif (placeholder — toutes
  // affichées tant qu'on n'a pas de vraie association collection↔onglet)
  const visibleCollections = COLLECTIONS;
  // userHasPlan + recipes sont passés au composant mais pas utilisés
  // dans cette V1 (le POC est UI-only, sans branchement data réel).
  // On les garde dans la signature pour éviter une migration ultérieure.
  void userHasPlan;
  void countByTab;

  return (
    <div className="space-y-5">
      {/* Titre principal — script coral-dark (meilleur contraste sur le
          dégradé rose qu'un simple coral), drop-shadow subtil pour donner
          du relief sans casser l'esprit aquarelle. */}
      <h1
        className="mt-4 text-center font-script text-5xl text-coral-dark lg:text-6xl"
        style={{
          textShadow: '0 1px 2px rgba(255,255,255,0.6), 0 2px 4px rgba(226,120,141,0.15)',
        }}
      >
        Idées recettes
      </h1>

      {/* Barre de recherche + bouton filtres — version compacte
          (h-9 → h-10 total) pour ne pas voler trop d'espace vertical. */}
      <div className="flex items-center gap-1.5 rounded-full bg-white px-2 py-1 shadow-sm ring-1 ring-coral-soft/40">
        <Search className="ml-1 size-4 shrink-0 text-ink-soft" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une recette…"
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
        {/* Chevron GAUCHE — apparaît seulement si on peut scroller à
            gauche (= si on a déjà scrollé vers la droite). */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollBy('left')}
            aria-label="Voir les onglets précédents"
            className="pointer-events-auto absolute left-0 top-1/2 z-10 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white/40 text-coral-dark/80 backdrop-blur-sm transition hover:bg-white/70"
          >
            <ChevronLeft className="size-4" strokeWidth={2.5} />
          </button>
        )}
        {/* Chevron DROITE — apparaît seulement s'il reste des onglets
            à voir à droite. */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollBy('right')}
            aria-label="Voir les onglets suivants"
            className="pointer-events-auto absolute right-0 top-1/2 z-10 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white/40 text-coral-dark/80 backdrop-blur-sm transition hover:bg-white/70"
          >
            <ChevronRight className="size-4" strokeWidth={2.5} />
          </button>
        )}
      {/* Onglets horizontaux scrollables. Style "fondu" : pas de pastille
          blanche, l'illustration aquarelle est posée directement sur le
          fond rose. Petits séparateurs verticaux entre les onglets.
          L'onglet actif est marqué par un point coral sous le label
          (pas de ring ni de fond — c'est l'illustration qui parle). */}
      <nav
        ref={scrollerRef as React.RefObject<HTMLElement>}
        aria-label="Catégorie de recette"
        className="-mx-3 overflow-x-auto px-3 pb-2 lg:overflow-visible"
        style={{ scrollbarWidth: 'none' }}
      >
        {/* Sur PC (lg+) : on distribue les 7 onglets sur toute la
            largeur dispo (justify-between) et on garantit que chaque
            onglet prend une part équitable (flex-1). Sur mobile, on
            garde le scroll horizontal avec largeur fixe. */}
        <div className="flex items-stretch gap-0 snap-x snap-mandatory lg:justify-between lg:gap-2">
          {TABS.map((tab, i) => {
            const isActive = tab.id === activeTab;
            return (
              <div key={tab.id} className="flex items-stretch">
                {/* Séparateur vertical entre onglets (sauf avant le 1er
                    et sur lg+ où les onglets sont distribués). */}
                {i > 0 && (
                  <span
                    aria-hidden
                    className="mx-1 my-3 w-px self-center bg-coral-soft/50 lg:hidden"
                    style={{ height: '2.5rem' }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={isActive}
                  className="relative flex w-[5rem] shrink-0 snap-start flex-col items-center gap-1 px-1 py-2 transition active:scale-95 lg:w-auto lg:flex-1 lg:gap-2 lg:py-3"
                >
                  {/* Ordre : label EN HAUT, image en dessous. Inversion
                      demandée par Karine 2026-06-07 — l'œil voit d'abord
                      le mot, puis confirme avec l'illustration. */}
                  <span
                    className={`text-sm transition-all ${
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

      {/* Section "Collections Karine". */}
      <section className="space-y-4 pt-4">
        <h2
          className="text-center font-script text-4xl text-coral-dark lg:text-5xl"
          style={{
            textShadow:
              '0 1px 2px rgba(255,255,255,0.6), 0 2px 4px rgba(226,120,141,0.15)',
          }}
        >
          Collections Karine
        </h2>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {visibleCollections.map((c) => (
            <CollectionCard key={c.id} collection={c} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <Link
      // Stub : route /recettes/collection/[id] à créer en phase 2.
      // Pour l'instant on pointe vers /recettes pour ne pas casser.
      href={`/recettes?collection=${collection.id}`}
      className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-coral-soft/30 transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold text-ink">{collection.name}</p>
        <p className="truncate text-xs italic text-ink-soft">
          {collection.subtitle}
        </p>
      </div>
      <span
        className="grid size-14 shrink-0 place-items-center rounded-xl bg-coral-soft/20 text-4xl"
        aria-hidden
      >
        {collection.emoji}
      </span>
      <ChevronRight className="size-4 shrink-0 text-coral" />
    </Link>
  );
}
