'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { NutriScoreRulesPanel } from './NutriScoreRulesPanel';
import type { NutriscoreGrade } from '@/lib/nutriscore';

export type MenuMealSheetLite = {
  id: string;
  menuId: string;
  dayIndex: number;
  mealKind: 'lunch' | 'dinner';
  title: string | null;
  servings: number;
  ingredients: RecipeIngredient[];
  nutriscoreGrade: NutriscoreGrade | null;
  nutriscoreConfidence: number | null;
};

export type MenuLite = {
  id: string;
  title: string;
  weekStart: string;
  status: string;
  mealSheets: MenuMealSheetLite[];
  avgGrade: NutriscoreGrade | null;
  avgConfidence: number;
  avgCount: number;
};
import type { RecipeIngredient, RecipeCategory } from '@/data/recipes';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/data/recipes';
import {
  aggregateIngredients,
  quickMatchCiqual,
  type CiqualFoodLite,
} from '@/lib/nutriscore-aggregate';
import { computeNutriscore } from '@/lib/nutriscore';
import { NutriScoreBadge } from '@/components/recettes/NutriScoreBadge';

type RecipeLite = {
  id: number;
  slug: string;
  title: string;
  category: string;
  is_public: boolean;
  status: string;
};

type SheetLite = {
  id: string;
  recipe_id: number;
  sheet_index: number;
  title: string | null;
  calories: number | null;
  servings: number;
  ingredients: RecipeIngredient[];
};

/**
 * Page admin Nutri-Score — éditeur interactif.
 *
 *  - Sidebar gauche : liste recettes triées par confiance (faible → fort)
 *    pour que Karine attaque d'abord celles qui en ont besoin
 *  - Zone droite : éditeur de la recette sélectionnée
 *    - Liste des ingrédients
 *    - Saisie qty + unit
 *    - Picker Ciqual avec recherche
 *    - Badge Nutri-Score live (recalcul à chaque édition)
 *    - Bouton "Sauvegarder" : PATCH endpoint /api/admin/.../ingredients
 *
 * Tout le state vit dans le composant — pas de persistance tant que
 * Karine n'a pas cliqué "Sauvegarder".
 */
export function NutriScoreAdminClient({
  recipes,
  sheets,
  ciqualBootstrap,
  menus = [],
}: {
  recipes: RecipeLite[];
  sheets: SheetLite[];
  ciqualBootstrap: CiqualFoodLite[];
  menus?: MenuLite[];
}) {
  // Pool Ciqual côté client : seed avec le bootstrap + s'enrichit au fur
  // et à mesure que Karine cherche / sélectionne des aliments.
  const [ciqualPool, setCiqualPool] = useState<CiqualFoodLite[]>(ciqualBootstrap);
  // 1 entrée sidebar = 1 sheet (pas 1 recipe). Une recette "4 Salades"
  // a 4 sheets → 4 entrées. Karine doit pouvoir éditer chaque sheet
  // individuellement et voir son Nutri-Score propre.
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(
    sheets[0]?.id ?? null,
  );
  // Sur mobile uniquement : quand Karine sélectionne une recette, la
  // liste se cache pour laisser place à l'éditeur (peu de largeur écran).
  // Sur desktop (lg+), les 2 zones restent visibles via les classes
  // lg:flex (forcent l'affichage indépendamment de ce state).
  const [showListMobile, setShowListMobile] = useState(true);
  // Dirty flag remonté depuis le RecipeEditor : permet d'afficher un
  // warning si Karine tente de switcher de recette sans sauvegarder.
  const [editorDirty, setEditorDirty] = useState(false);
  // Sheet qu'on tente de sélectionner alors qu'il y a des modifs
  // non sauvegardées — on stocke en attente de la décision du modal.
  // (sheetId est string : 1 entrée sidebar = 1 sheet, pas 1 recipe.)
  const [pendingSheetId, setPendingSheetId] = useState<string | null>(null);
  // Filtre catégorie sidebar : "all" affiche tout, sinon filtre.
  const [categoryFilter, setCategoryFilter] = useState<RecipeCategory | 'all'>('all');
  // Onglet courant du panel droit : éditeur de recette ou règles.
  const [activeTab, setActiveTab] = useState<'editor' | 'rules'>('editor');
  // Mode de la sidebar : "recettes" (liste plate) ou "menus" (semaines
  // accordéon avec leurs jours). Validé Didier 2026-06-08.
  const [sidebarMode, setSidebarMode] = useState<'recipes' | 'menus'>('recipes');
  // Quand mode = "menus", la cellule cliquée sélectionne une
  // menu_meal_sheet (différent du selectedRecipeId qui pointe vers
  // une recipe_sheet du catalogue).
  const [selectedMealSheetId, setSelectedMealSheetId] = useState<string | null>(null);

  // Helper pour demander confirmation avant de switcher si dirty.
  // window.confirm interdit (feedback projet) → on utilise ConfirmModal.
  const selectSheetWithGuard = (id: string) => {
    if (editorDirty) {
      setPendingSheetId(id);
      return;
    }
    setSelectedSheetId(id);
    setShowListMobile(false);
  };

  const confirmSwitchSheet = () => {
    if (pendingSheetId === null) return;
    setSelectedSheetId(pendingSheetId);
    setShowListMobile(false);
    setEditorDirty(false);
    setPendingSheetId(null);
  };

  // 1 entrée par SHEET (et non par recipe). Une recette à 4 fiches
  // produit 4 stats. Karine peut alors éditer chaque fiche
  // individuellement et constater son score propre.
  //
  // On masque le grade Nutri-Score si confiance < 30 % : avec si peu
  // d'ingrédients matchés, le score est aléatoire (souvent A "bidon"
  // parce que toutes les valeurs nutritionnelles sont à 0).
  const sheetStats = useMemo(() => {
    const ciqualGroups = new Map(
      ciqualPool.map((c) => [c.id, (c as any).group_name ?? '']),
    );
    // Map<ciqual_id, avg_unit_weight_g> alimentée par Mistral via le
    // persist helper TS. Le sentinel 0.0001 = "1 unité n'a pas de sens".
    const ciqualUnitWeights = new Map<number, number>(
      ciqualPool
        .filter((c) => typeof c.avg_unit_weight_g === 'number' && (c.avg_unit_weight_g as number) > 0.01)
        .map((c) => [c.id, c.avg_unit_weight_g as number]),
    );
    const recipeById = new Map(recipes.map((r) => [r.id, r]));
    return sheets
      .map((sheet) => {
        const recipe = recipeById.get(sheet.recipe_id);
        if (!recipe) return null;
        if (!sheet.ingredients || sheet.ingredients.length === 0) {
          return { recipe, sheet, agg: null, score: null };
        }
        const agg = aggregateIngredients(sheet.ingredients, ciqualPool, ciqualGroups, ciqualUnitWeights);
        const canScore = agg.totalGrams > 0 && agg.confidence >= 0.3;
        const score = canScore ? computeNutriscore(agg.per100g, 'GENERIC') : null;
        return { recipe, sheet, agg, score };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [recipes, sheets, ciqualPool]);

  // Nombre total de sheets par recipe (pour afficher "fiche n/N" quand >1).
  const sheetCountByRecipe = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of sheets) m.set(s.recipe_id, (m.get(s.recipe_id) ?? 0) + 1);
    return m;
  }, [sheets]);

  // Tri stable mémoisé : confiance croissante, puis sheet_index pour
  // grouper les sheets d'une même recette, puis sheet.id comme
  // tiebreaker absolu (UUID → ordre déterministe identique server/client).
  // Évite tout risque d'hydration mismatch entre 2 sheets à confiance
  // identique (ex : 2 recettes à 100 % de confiance).
  const sortedSheetStats = useMemo(() => {
    return sheetStats.slice().sort((a, b) => {
      if (a.recipe.id !== b.recipe.id) {
        const ca = a.agg?.confidence ?? 0;
        const cb = b.agg?.confidence ?? 0;
        if (ca !== cb) return ca - cb;
        const titleCmp = a.recipe.title.localeCompare(b.recipe.title);
        if (titleCmp !== 0) return titleCmp;
      } else if (a.sheet.sheet_index !== b.sheet.sheet_index) {
        return a.sheet.sheet_index - b.sheet.sheet_index;
      }
      return a.sheet.id.localeCompare(b.sheet.id);
    });
  }, [sheetStats]);

  const selectedStat = sheetStats.find((s) => s.sheet.id === selectedSheetId) ?? null;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-4 lg:flex-row">
      {/* Sidebar : visible sur mobile UNIQUEMENT si showListMobile.
          Sur desktop (lg+), forcée visible via lg:flex. */}
      <aside
        className={`${
          showListMobile ? 'flex' : 'hidden'
        } flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-coral-soft/30 lg:flex lg:w-80 lg:shrink-0`}
      >
        {/* Toggle Recettes / Menus en haut de la sidebar — change ce
            que liste la sidebar (pas l'éditeur droit). */}
        <div className="flex shrink-0 gap-1 border-b border-coral-soft/30 bg-coral-soft/10 p-2">
          <button
            type="button"
            onClick={() => setSidebarMode('recipes')}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-bold transition ${
              sidebarMode === 'recipes'
                ? 'bg-white text-coral-dark shadow-sm'
                : 'text-coral-dark/70 hover:text-coral-dark'
            }`}
          >
            Recettes ({recipes.length})
          </button>
          <button
            type="button"
            onClick={() => setSidebarMode('menus')}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-bold transition ${
              sidebarMode === 'menus'
                ? 'bg-white text-coral-dark shadow-sm'
                : 'text-coral-dark/70 hover:text-coral-dark'
            }`}
          >
            Menus ({menus.length})
          </button>
        </div>

        {/* Filtre par catégorie — visible uniquement en mode recettes.
            Scrollable horizontalement. "Toutes" + une pastille par
            catégorie. La catégorie active est en avant (coral). */}
        {sidebarMode === 'recipes' && (
        <div className="overflow-x-auto border-b border-coral-soft/20 px-2 py-2">
          <div className="flex w-max gap-1">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${
                categoryFilter === 'all'
                  ? 'bg-coral text-white shadow-sm'
                  : 'bg-coral-soft/20 text-coral-dark hover:bg-coral-soft/40'
              }`}
            >
              Toutes
            </button>
            {CATEGORY_ORDER.map((cat) => {
              const count = sheetStats.filter((s) => s.recipe.category === cat).length;
              if (count === 0) return null; // catégorie vide → cachée
              const isActive = categoryFilter === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${
                    isActive
                      ? 'bg-coral text-white shadow-sm'
                      : 'bg-coral-soft/20 text-coral-dark hover:bg-coral-soft/40'
                  }`}
                >
                  {CATEGORY_LABELS[cat]} ({count})
                </button>
              );
            })}
          </div>
        </div>
        )}

        {sidebarMode === 'menus' ? (
          <MenusSidebar
            menus={menus}
            selectedMealSheetId={selectedMealSheetId}
            onSelectMealSheet={(sheet) => {
              setSelectedMealSheetId(sheet.id);
              setShowListMobile(false);
            }}
          />
        ) : (
        <ul className="flex-1 overflow-y-auto">
          {sortedSheetStats
            .filter(
              (s) =>
                categoryFilter === 'all' || s.recipe.category === categoryFilter,
            )
            .map((stat) => {
              const isSelected = stat.sheet.id === selectedSheetId;
              const conf = stat.agg?.confidence ?? 0;
              const totalSheets = sheetCountByRecipe.get(stat.recipe.id) ?? 1;
              const hasMultipleSheets = totalSheets > 1;
              // Titre principal = nom de la sheet (ex. "Salade Pomme Raisin
              // Poire Grenade"). Fallback : titre recette mère si pas de
              // titre de sheet. Le contexte parent va en sous-titre.
              const sheetTitle =
                stat.sheet.title?.trim() ||
                (hasMultipleSheets
                  ? `Fiche ${stat.sheet.sheet_index + 1}/${totalSheets}`
                  : stat.recipe.title);
              return (
                <li key={stat.sheet.id}>
                  <button
                    type="button"
                    onClick={() => selectSheetWithGuard(stat.sheet.id)}
                    className={`block w-full border-b border-coral-soft/15 px-3 py-2 text-left transition ${
                      isSelected
                        ? 'bg-coral-soft/30'
                        : 'bg-white hover:bg-coral-soft/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold leading-tight text-ink line-clamp-2">
                        {sheetTitle}
                      </span>
                      {stat.score ? (
                        <span
                          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded text-xs font-extrabold text-white"
                          style={{
                            backgroundColor: gradeColor(stat.score.grade),
                          }}
                        >
                          {stat.score.grade}
                        </span>
                      ) : (
                        <span
                          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded bg-ink-soft/30 text-xs font-bold text-ink-soft"
                          title="Score à compléter"
                        >
                          ?
                        </span>
                      )}
                    </div>
                    {/* Sous-titre : recette parente (si plusieurs sheets) +
                        catégorie + % confiance. Sur 1 ligne tronquée pour
                        ne pas alourdir, mais le titre principal au-dessus
                        peut prendre 2 lignes. */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.65rem] text-ink-soft">
                      {hasMultipleSheets && (
                        <span className="truncate italic">
                          {stat.recipe.title}
                        </span>
                      )}
                      <span>{stat.recipe.category}</span>
                      {stat.agg && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 font-semibold ${
                            conf >= 0.85
                              ? 'bg-sage/20 text-sage'
                              : conf >= 0.6
                                ? 'bg-tangerine/20 text-tangerine'
                                : 'bg-coral/20 text-coral-dark'
                          }`}
                        >
                          {Math.round(conf * 100)}%
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
        </ul>
        )}
      </aside>

      {/* Zone éditeur : sur mobile, visible UNIQUEMENT si showListMobile
          est false. Sur desktop (lg+), toujours visible (lg:flex). */}
      <main
        className={`${
          showListMobile ? 'hidden' : 'flex'
        } flex-1 flex-col overflow-y-auto rounded-2xl bg-white p-5 shadow-sm ring-1 ring-coral-soft/30 lg:flex`}
      >
        {/* Header : bouton retour mobile + onglets éditeur/règles */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowListMobile(true)}
            className="flex items-center gap-1.5 rounded-full bg-coral-soft/30 px-3 py-1 text-xs font-semibold text-coral-dark hover:bg-coral-soft/50 lg:hidden"
          >
            <ArrowLeft className="h-3 w-3" /> Liste
          </button>
          <div className="ml-auto flex items-center gap-1 rounded-full bg-coral-soft/15 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('editor')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                activeTab === 'editor'
                  ? 'bg-white text-coral-dark shadow-sm'
                  : 'text-coral-dark/70 hover:text-coral-dark'
              }`}
            >
              Éditeur
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                activeTab === 'rules'
                  ? 'bg-white text-coral-dark shadow-sm'
                  : 'text-coral-dark/70 hover:text-coral-dark'
              }`}
            >
              Règles
            </button>
          </div>
        </div>

        {activeTab === 'rules' ? (
          <NutriScoreRulesPanel />
        ) : sidebarMode === 'menus' ? (
          (() => {
            const sheet = menus
              .flatMap((m) => m.mealSheets)
              .find((s) => s.id === selectedMealSheetId);
            if (!sheet) {
              return (
                <p className="text-center text-ink-soft">
                  Sélectionne un repas dans un menu à gauche.
                </p>
              );
            }
            return (
              <MenuMealSheetEditor
                key={sheet.id}
                sheet={sheet}
                ciqualPool={ciqualPool}
                onDirtyChange={setEditorDirty}
                onCiqualPoolUpdate={(more) => {
                  setCiqualPool((prev) => {
                    const seen = new Set(prev.map((c) => c.id));
                    return [...prev, ...more.filter((c) => !seen.has(c.id))];
                  });
                }}
              />
            );
          })()
        ) : !selectedStat || !selectedStat.sheet ? (
          <p className="text-center text-ink-soft">
            Sélectionne une fiche dans la liste de gauche.
          </p>
        ) : (
          <RecipeEditor
            key={selectedStat.sheet.id}
            recipe={selectedStat.recipe}
            sheet={selectedStat.sheet}
            ciqualPool={ciqualPool}
            onDirtyChange={setEditorDirty}
            onCiqualPoolUpdate={(more) => {
              setCiqualPool((prev) => {
                const seen = new Set(prev.map((c) => c.id));
                return [...prev, ...more.filter((c) => !seen.has(c.id))];
              });
            }}
          />
        )}
      </main>

      {/* Modal de confirmation au switch de recette si dirty.
          Remplace window.confirm() (interdit par les conventions du
          projet, cf. feedback_no_native_dialogs). */}
      <ConfirmModal
        open={pendingSheetId !== null}
        title="Modifications non sauvegardées"
        message="Tu as des modifications non sauvegardées sur cette fiche. Quitter sans sauvegarder ?"
        confirmLabel="Quitter sans sauvegarder"
        cancelLabel="Rester ici"
        variant="danger"
        onConfirm={confirmSwitchSheet}
        onCancel={() => setPendingSheetId(null)}
      />
    </div>
  );
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A':
      return '#038141';
    case 'B':
      return '#85bb2f';
    case 'C':
      return '#fecb02';
    case 'D':
      return '#ee8100';
    case 'E':
    default:
      return '#e63e11';
  }
}

// =====================================================================
// Editeur d'une recette
// =====================================================================

function RecipeEditor({
  recipe,
  sheet,
  ciqualPool,
  onDirtyChange,
  onCiqualPoolUpdate,
}: {
  recipe: RecipeLite;
  sheet: SheetLite;
  ciqualPool: CiqualFoodLite[];
  /** Notifie le parent quand l'état dirty change (pour le warning au
   *  switch de recette). */
  onDirtyChange: (dirty: boolean) => void;
  onCiqualPoolUpdate: (more: CiqualFoodLite[]) => void;
}) {
  // Auto-assign à l'ouverture : pour chaque ingrédient SANS lien
  // explicite, on remplit `ciqual_food_id` avec le meilleur match auto.
  // Si déjà lié (Karine a passé une fois → champ déjà en BDD), on ne
  // touche PAS — c'est le cas "conflit" du cahier des charges.
  // L'écriture en mémoire compte comme un état initial à sauvegarder.
  const [ings, setIngs] = useState<RecipeIngredient[]>(() => {
    const initial = sheet.ingredients ?? [];
    return initial.map((ing) => {
      if (typeof ing.ciqual_food_id === 'number') return ing;
      const match = quickMatchCiqual(ing.label, ciqualPool);
      return match ? { ...ing, ciqual_food_id: match.id } : ing;
    });
  });
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  // Dirty flag : true UNIQUEMENT quand Karine a interagi manuellement
  // (saisi une qty, changé un lien, etc.). Les matches auto initiaux
  // ne comptent PAS — sinon le warning apparaîtrait à chaque ouverture
  // de recette même sans rien faire. Si elle quitte sans sauvegarder,
  // les matches auto seront simplement recalculés à la prochaine
  // ouverture (perte zéro).
  const [isDirty, setIsDirty] = useState(false);

  // Recalcul à la volée à chaque édition
  const agg = useMemo(() => {
    const ciqualGroups = new Map(
      ciqualPool.map((c) => [c.id, (c as any).group_name ?? '']),
    );
    const ciqualUnitWeights = new Map<number, number>(
      ciqualPool
        .filter((c) => typeof c.avg_unit_weight_g === 'number' && (c.avg_unit_weight_g as number) > 0.01)
        .map((c) => [c.id, c.avg_unit_weight_g as number]),
    );
    return aggregateIngredients(ings, ciqualPool, ciqualGroups, ciqualUnitWeights);
  }, [ings, ciqualPool]);

  // Warning beforeunload : si l'utilisatrice ferme l'onglet alors que
  // des changements ne sont pas sauvegardés, le navigateur affiche le
  // dialog standard "Voulez-vous vraiment quitter ?". Pas de message
  // custom possible (politique navigateurs modernes).
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Remonte l'état dirty au parent (utilisé pour le confirm() au switch
  // de recette dans la sidebar).
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // Pas de score affichable si la confiance est trop basse (< 30%) :
  // avec si peu d'ingrédients matchés, le grade serait trompeur (les
  // valeurs nutritionnelles seraient quasiment toutes à zéro et le
  // calcul retomberait sur A par défaut).
  const score = agg.totalGrams > 0 && agg.confidence >= 0.3
    ? computeNutriscore(agg.per100g, 'GENERIC')
    : null;

  const updateIng = (i: number, patch: Partial<RecipeIngredient>) => {
    setIngs((prev) => prev.map((ing, k) => (k === i ? { ...ing, ...patch } : ing)));
    setIsDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setSavedMsg(null);
    try {
      // Endpoint existant : PATCH une sheet avec champs partiels.
      // On ne touche QUE `ingredients` (sanitizeIngredients préserve
      // ciqual_food_id depuis l'update du 2026-06-08).
      const res = await fetch(
        `/api/admin/recipes/${recipe.slug}/sheets/${sheet.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredients: ings }),
        },
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Erreur inconnue');
      setSavedMsg('✓ Enregistré');
      setIsDirty(false); // état BDD = état mémoire, plus de warning
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e: unknown) {
      setSavedMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header avec score live */}
      <header className="flex items-start gap-5 border-b border-coral-soft/30 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-ink">{recipe.title}</h1>
          <p className="text-sm text-ink-soft">
            {recipe.category} · fiche #{sheet.sheet_index} ·{' '}
            {ings.length} ingrédient(s) · {Math.round(agg.totalGrams)} g total
          </p>
        </div>
        {score ? (
          <div className="flex shrink-0 flex-col items-center">
            <NutriScoreBadge grade={score.grade} size="sm" />
            <p className="mt-1 text-[0.65rem] text-ink-soft">
              Confiance{' '}
              <span
                className={`font-bold ${
                  agg.confidence >= 0.85
                    ? 'text-sage'
                    : agg.confidence >= 0.6
                      ? 'text-tangerine'
                      : 'text-coral-dark'
                }`}
              >
                {Math.round(agg.confidence * 100)}%
              </span>
            </p>
          </div>
        ) : (
          <div className="flex shrink-0 flex-col items-center rounded-lg bg-tangerine/10 px-3 py-2 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-tangerine/30 text-2xl font-bold text-tangerine">
              ?
            </span>
            <p className="mt-1 text-[0.65rem] text-tangerine">
              Score à compléter
            </p>
            <p className="text-[0.55rem] italic text-ink-soft">
              {Math.round(agg.confidence * 100)}% des ingrédients identifiés
            </p>
          </div>
        )}
      </header>

      {/* Bouton sauvegarder */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full bg-coral px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
        >
          {saving ? 'Sauvegarde…' : 'Sauvegarder'}
        </button>
        {savedMsg && (
          <span
            className={`text-sm font-semibold ${
              savedMsg.startsWith('✓') ? 'text-sage' : 'text-coral-dark'
            }`}
          >
            {savedMsg}
          </span>
        )}
      </div>

      {/* Liste ingrédients éditable */}
      <div className="space-y-2">
        {ings.map((ing, i) => (
          <IngredientRow
            key={i}
            ing={ing}
            ciqualPool={ciqualPool}
            onChange={(patch) => updateIng(i, patch)}
            onCiqualPoolUpdate={onCiqualPoolUpdate}
          />
        ))}
        {ings.length === 0 && (
          <p className="text-sm italic text-ink-soft">
            Cette fiche n&apos;a pas d&apos;ingrédient renseigné.
          </p>
        )}
      </div>

      {/* Valeurs par 100g — pour debug */}
      {score && (
        <details className="mt-6 rounded-md bg-coral-soft/10 p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-coral-dark">
            Détail calcul ({score.points} points)
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <p className="font-bold">Par 100g du plat :</p>
              <ul className="mt-1 space-y-0.5 text-ink-soft">
                <li>kcal : {Math.round(agg.per100g.kcal)}</li>
                <li>Sucres : {agg.per100g.sugars.toFixed(1)} g</li>
                <li>AGS : {agg.per100g.saturatedFat.toFixed(1)} g</li>
                <li>Sodium : {Math.round(agg.per100g.sodiumMg)} mg</li>
                <li>Fibres : {agg.per100g.fibers.toFixed(1)} g</li>
                <li>Protéines : {agg.per100g.proteins.toFixed(1)} g</li>
                <li>FVL : {Math.round(agg.per100g.fruitsVegLegumesPct)} %</li>
              </ul>
            </div>
            <div>
              <p className="font-bold">Points :</p>
              <ul className="mt-1 space-y-0.5 text-ink-soft">
                <li>Énergie : {score.breakdown.negativeDetail.energy}</li>
                <li>Sucres : {score.breakdown.negativeDetail.sugars}</li>
                <li>AGS : {score.breakdown.negativeDetail.saturatedFat}</li>
                <li>Sodium : {score.breakdown.negativeDetail.sodium}</li>
                <li className="border-t border-coral-soft/40 pt-1 font-bold">
                  Négatifs : {score.breakdown.negativePoints}
                </li>
                <li>Fibres : {score.breakdown.positiveDetail.fibers}</li>
                <li>Protéines : {score.breakdown.positiveDetail.proteins}</li>
                <li>FVL : {score.breakdown.positiveDetail.fvl}</li>
                <li className="border-t border-coral-soft/40 pt-1 font-bold">
                  Positifs : {score.breakdown.positivePoints}
                </li>
              </ul>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

// =====================================================================
// Ligne d'un ingrédient avec édition qty + picker Ciqual
// =====================================================================

function IngredientRow({
  ing,
  ciqualPool,
  onChange,
  onCiqualPoolUpdate,
}: {
  ing: RecipeIngredient;
  ciqualPool: CiqualFoodLite[];
  onChange: (patch: Partial<RecipeIngredient>) => void;
  onCiqualPoolUpdate: (more: CiqualFoodLite[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const linkedFood =
    typeof ing.ciqual_food_id === 'number'
      ? ciqualPool.find((c) => c.id === ing.ciqual_food_id)
      : null;
  const hasQty = typeof ing.quantity === 'number' && ing.quantity > 0;

  // 2 états seulement (validés par le user 2026-06-08, "simplicité") :
  //  - assigné (auto ou manuel) → vert, bouton "Changer"
  //  - rien trouvé              → rose, bouton "Chercher"
  const wrapperClass =
    linkedFood && hasQty
      ? 'border-sage/40 bg-sage/5'
      : 'border-coral-soft/40 bg-coral-soft/5';

  return (
    <div className={`rounded-lg border p-2 transition ${wrapperClass}`}>
      {/* Layout colonne sur mobile, row sur desktop. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{ing.label}</p>
          <p className="truncate text-xs italic">
            {linkedFood ? (
              <span className="text-sage">→ {linkedFood.name}</span>
            ) : (
              <span className="text-coral-dark">Aucun match Ciqual</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Qty */}
          <input
            type="number"
            step="0.1"
            min="0"
            value={ing.quantity ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ quantity: v === '' ? null : Number(v) });
            }}
            placeholder="qty"
            className={`w-20 rounded border px-2 py-1 text-sm ${
              hasQty
                ? 'border-sage/40 bg-white'
                : 'border-coral-soft/60 bg-coral-soft/20 placeholder-coral-dark/50'
            }`}
          />

          {/* Unit */}
          <input
            type="text"
            value={ing.unit ?? ''}
            onChange={(e) => onChange({ unit: e.target.value || null })}
            placeholder="g, cs, ml…"
            className="w-20 rounded border border-coral-soft/40 px-2 py-1 text-xs"
          />

          {/* Bouton picker — "Changer" si déjà assigné, "Chercher" sinon */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={`shrink-0 rounded-md px-3 py-1 text-xs font-semibold transition ${
              linkedFood
                ? 'bg-sage/20 text-sage hover:bg-sage/30'
                : 'bg-coral-soft/40 text-coral-dark hover:bg-coral-soft/60'
            }`}
          >
            {linkedFood ? 'Changer' : 'Chercher'}{' '}
            <ChevronDown className="inline h-3 w-3" />
          </button>
        </div>
      </div>

      {pickerOpen && (
        <CiqualPicker
          initialQuery={ing.label}
          onPick={(food) => {
            onChange({ ciqual_food_id: food.id });
            onCiqualPoolUpdate([food]);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// =====================================================================
// Picker Ciqual avec autocomplete
// =====================================================================

function CiqualPicker({
  initialQuery,
  onPick,
  onClose,
}: {
  initialQuery: string;
  onPick: (food: CiqualFoodLite) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<CiqualFoodLite[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/admin/ciqual/search?q=${encodeURIComponent(trimmed)}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((j) => setResults(j.results ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [q]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-20"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-coral-dark">Lier un ingrédient Ciqual</h3>
          <button type="button" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5 text-ink-soft hover:text-ink" />
          </button>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher dans Ciqual (3000 aliments ANSES)…"
            className="w-full rounded-full border border-coral-soft/60 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-coral"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-soft" />
          )}
        </div>

        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {results.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onPick(f)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-coral-soft/30 bg-white p-2 text-left text-sm transition hover:bg-coral-soft/10"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{f.name}</p>
                  <p className="truncate text-[0.65rem] text-ink-soft">
                    {(f as any).group_name ?? '—'}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[0.65rem] text-ink-soft">
                  <p>{Math.round(f.kcal_per_100g ?? 0)} kcal/100g</p>
                  <p>{(f.proteins_g ?? 0).toFixed(1)}g prot</p>
                </div>
                <Check className="h-4 w-4 text-coral opacity-0 transition group-hover:opacity-100" />
              </button>
            </li>
          ))}
          {!loading && q.trim().length >= 2 && results.length === 0 && (
            <li className="py-4 text-center text-sm text-ink-soft">
              Aucun résultat. Essaie un autre terme.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

// =====================================================================
// Sidebar mode "Menus" — accordéon par semaine, jours déroulables,
// clic sur un repas-recette ouvre l'éditeur à droite.
// =====================================================================

const DAY_NAMES_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function formatWeekStart(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  } catch {
    return dateStr;
  }
}

function MenusSidebar({
  menus,
  selectedMealSheetId,
  onSelectMealSheet,
}: {
  menus: MenuLite[];
  selectedMealSheetId: string | null;
  onSelectMealSheet: (sheet: MenuMealSheetLite) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(
    menus[0]?.id ?? null,
  );

  if (menus.length === 0) {
    return (
      <div className="flex-1 px-3 py-4">
        <p className="text-center text-xs italic text-ink-soft">
          Aucun menu publié.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto">
      {menus.map((menu) => {
        const isOpen = openMenuId === menu.id;
        // Groupe par jour pour le rendu.
        const byDay = new Map<number, { lunch?: MenuMealSheetLite; dinner?: MenuMealSheetLite }>();
        for (const s of menu.mealSheets) {
          if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, {});
          byDay.get(s.dayIndex)![s.mealKind] = s;
        }
        const days = Array.from(byDay.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([dayIndex, slots]) => ({ dayIndex, ...slots }));
        return (
          <li key={menu.id} className="border-b border-coral-soft/15">
            <button
              type="button"
              onClick={() => setOpenMenuId(isOpen ? null : menu.id)}
              className="flex w-full items-center gap-2 bg-white px-3 py-2 text-left transition hover:bg-coral-soft/10"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">
                  {menu.title || `Semaine du ${formatWeekStart(menu.weekStart)}`}
                </span>
                <span className="block text-[0.65rem] text-ink-soft">
                  {formatWeekStart(menu.weekStart)} · {menu.status} · {menu.mealSheets.length} repas
                </span>
              </span>
              {menu.avgGrade && (
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-xs font-extrabold"
                  style={{
                    backgroundColor: gradeColor(menu.avgGrade),
                    color: menu.avgGrade === 'C' ? '#000' : '#fff',
                  }}
                  title={`Moyenne hebdo ${menu.avgGrade} (${menu.avgCount} repas)`}
                >
                  {menu.avgGrade}
                </span>
              )}
            </button>

            {isOpen && (
              <ul className="bg-coral-soft/5">
                {days.length === 0 ? (
                  <li className="px-3 py-3 text-xs italic text-ink-soft">
                    Aucune fiche repas créée pour ce menu.
                  </li>
                ) : (
                  days.flatMap((d) => {
                    const dayName = DAY_NAMES_FR[d.dayIndex] ?? `J${d.dayIndex + 1}`;
                    return [
                      <li key={`${d.dayIndex}-lunch`}>
                        <MealCell
                          kind="Déjeuner"
                          sheet={d.lunch}
                          dayName={dayName}
                          selectedMealSheetId={selectedMealSheetId}
                          onSelect={onSelectMealSheet}
                        />
                      </li>,
                      <li key={`${d.dayIndex}-dinner`}>
                        <MealCell
                          kind="Dîner"
                          sheet={d.dinner}
                          dayName={dayName}
                          selectedMealSheetId={selectedMealSheetId}
                          onSelect={onSelectMealSheet}
                        />
                      </li>,
                    ];
                  })
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MealCell({
  kind,
  sheet,
  dayName,
  selectedMealSheetId,
  onSelect,
}: {
  kind: 'Déjeuner' | 'Dîner';
  sheet: MenuMealSheetLite | undefined;
  dayName: string;
  selectedMealSheetId: string | null;
  onSelect: (sheet: MenuMealSheetLite) => void;
}) {
  const isClickable = !!sheet;
  const isSelected = isClickable && sheet.id === selectedMealSheetId;
  const grade = sheet?.nutriscoreGrade ?? null;
  const conf = sheet?.nutriscoreConfidence ?? 0;
  const title = sheet?.title ?? '';
  const slot = kind === 'Déjeuner' ? 'Midi' : 'Soir';
  return (
    <button
      type="button"
      onClick={() => {
        if (sheet) onSelect(sheet);
      }}
      disabled={!isClickable}
      className={`block w-full border-b border-coral-soft/15 px-3 py-2 text-left transition ${
        isSelected
          ? 'bg-coral-soft/30'
          : isClickable
            ? 'bg-white hover:bg-coral-soft/10'
            : 'bg-white/60'
      }`}
    >
      {/* Ligne 1 : titre du repas + grade A-E (même layout que la
          sidebar Recettes) */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink line-clamp-1">
          {title || (
            <span className="italic text-ink-soft">— pas de repas —</span>
          )}
        </span>
        {grade ? (
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-xs font-extrabold text-white"
            style={{ backgroundColor: gradeColor(grade) }}
          >
            {grade}
          </span>
        ) : isClickable ? (
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded bg-ink-soft/30 text-xs font-bold text-ink-soft"
            title="Score à compléter"
          >
            ?
          </span>
        ) : null}
      </div>

      {/* Ligne 2 : jour · slot + % confiance (équivalent de
          "catégorie · 80 %" sur la sidebar Recettes) */}
      <div className="mt-0.5 flex items-center gap-2 text-[0.65rem] text-ink-soft">
        <span>
          {dayName} · {slot}
        </span>
        {sheet && grade && (
          <span
            className={`rounded-full px-1.5 py-0.5 font-semibold ${
              conf >= 0.85
                ? 'bg-sage/20 text-sage'
                : conf >= 0.6
                  ? 'bg-tangerine/20 text-tangerine'
                  : 'bg-coral/20 text-coral-dark'
            }`}
          >
            {Math.round(conf * 100)}%
          </span>
        )}
      </div>
    </button>
  );
}

// =====================================================================
// Editeur d'une menu_meal_sheet — version dédiée aux fiches repas de
// menu (table menu_meal_sheets, endpoint distinct). Réutilise les
// composants IngredientRow + CiqualPicker du RecipeEditor pour rester
// cohérent visuellement.
// =====================================================================

function MenuMealSheetEditor({
  sheet,
  ciqualPool,
  onDirtyChange,
  onCiqualPoolUpdate,
}: {
  sheet: MenuMealSheetLite;
  ciqualPool: CiqualFoodLite[];
  onDirtyChange: (dirty: boolean) => void;
  onCiqualPoolUpdate: (more: CiqualFoodLite[]) => void;
}) {
  const [ings, setIngs] = useState<RecipeIngredient[]>(() => {
    const initial = sheet.ingredients ?? [];
    return initial.map((ing) => {
      if (typeof ing.ciqual_food_id === 'number') return ing;
      const match = quickMatchCiqual(ing.label, ciqualPool);
      return match ? { ...ing, ciqual_food_id: match.id } : ing;
    });
  });
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const agg = useMemo(() => {
    const ciqualGroups = new Map(
      ciqualPool.map((c) => [c.id, (c as any).group_name ?? '']),
    );
    return aggregateIngredients(ings, ciqualPool, ciqualGroups);
  }, [ings, ciqualPool]);

  const canScore = agg.totalGrams > 0 && agg.confidence >= 0.3;
  const score = canScore ? computeNutriscore(agg.per100g, 'GENERIC') : null;

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const updateIng = (i: number, patch: Partial<RecipeIngredient>) => {
    setIngs((prev) => prev.map((ing, k) => (k === i ? { ...ing, ...patch } : ing)));
    setIsDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch(
        `/api/admin/menus/${sheet.menuId}/meal-sheets/${sheet.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredients: ings }),
        },
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Erreur inconnue');
      setSavedMsg('✓ Enregistré');
      setIsDirty(false);
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e: unknown) {
      setSavedMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const slot = `${DAY_NAMES_FR[sheet.dayIndex] ?? `J${sheet.dayIndex + 1}`} · ${sheet.mealKind === 'lunch' ? 'Déjeuner' : 'Dîner'}`;

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-5 border-b border-coral-soft/30 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-ink">{sheet.title || slot}</h1>
          <p className="text-sm text-ink-soft">
            {slot} · {ings.length} ingrédient(s) · {Math.round(agg.totalGrams)} g total
          </p>
        </div>
        {score ? (
          <div className="flex shrink-0 flex-col items-center">
            <NutriScoreBadge grade={score.grade} size="sm" />
            <p className="mt-1 text-[0.65rem] text-ink-soft">
              Confiance{' '}
              <span
                className={`font-bold ${
                  agg.confidence >= 0.85
                    ? 'text-sage'
                    : agg.confidence >= 0.6
                      ? 'text-tangerine'
                      : 'text-coral-dark'
                }`}
              >
                {Math.round(agg.confidence * 100)}%
              </span>
            </p>
          </div>
        ) : (
          <div className="flex shrink-0 flex-col items-center rounded-lg bg-tangerine/10 px-3 py-2 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-tangerine/30 text-2xl font-bold text-tangerine">
              ?
            </span>
            <p className="mt-1 text-[0.65rem] text-tangerine">
              Score à compléter
            </p>
            <p className="text-[0.55rem] italic text-ink-soft">
              {Math.round(agg.confidence * 100)}% des ingrédients identifiés
            </p>
          </div>
        )}
      </header>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full bg-coral px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-50"
        >
          {saving ? 'Sauvegarde…' : 'Sauvegarder'}
        </button>
        {savedMsg && (
          <span
            className={`text-sm font-semibold ${
              savedMsg.startsWith('✓') ? 'text-sage' : 'text-coral-dark'
            }`}
          >
            {savedMsg}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {ings.map((ing, i) => (
          <IngredientRow
            key={i}
            ing={ing}
            ciqualPool={ciqualPool}
            onChange={(patch) => updateIng(i, patch)}
            onCiqualPoolUpdate={onCiqualPoolUpdate}
          />
        ))}
        {ings.length === 0 && (
          <p className="text-sm italic text-ink-soft">
            Cette fiche n&apos;a pas d&apos;ingrédient renseigné.
          </p>
        )}
      </div>
    </div>
  );
}

