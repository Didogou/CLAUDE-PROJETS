import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  itemDedupKey,
  type ShoppingItemSource,
  type ShoppingItemContribution,
  type ShoppingListV2,
  type ShoppingListV2Item,
  type ShoppingListLinkedRecipe,
} from '@/data/shopping-lists';
import type { RecipeIngredient } from '@/data/recipes';
import type { ShoppingListItem } from '@/data/menus';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Récupère la liste ACTIVE de l'utilisateur courant. Si aucune n'existe,
 * en crée une nouvelle vide avec le nom par défaut "Semaine du X au Y".
 */
export async function getOrCreateActiveList(userId: string): Promise<ShoppingListV2> {
  const supabase = await createClient();
  // SELECT active
  const { data, error } = await (supabase as any)
    .from('shopping_lists')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (data) return rowToList(data);

  // Aucune liste active → on en crée une avec le nom de la semaine courante
  const name = defaultListName(new Date());
  const { data: inserted, error: insErr } = await (supabase as any)
    .from('shopping_lists')
    .insert({ user_id: userId, name, status: 'active' })
    .select()
    .single();
  if (insErr) throw insErr;
  return rowToList(inserted);
}

/** Récupère l'historique (listes archivées) d'un user. */
export async function getArchivedLists(userId: string): Promise<ShoppingListV2[]> {
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from('shopping_lists')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'archived')
    .order('archived_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(rowToList);
}

/**
 * Ajoute (ou retire) une fiche détaillée à la liste active (toggle).
 * Si la sheet est déjà liée → on retire ses contributions de chaque item.
 * Sinon → on ajoute ses ingrédients en additionnant (ou créant) les items.
 *
 * L'unité d'ajout est désormais la SHEET, pas la recette mère :
 * "Poivrons farcis à la viande" et "Poivrons farcis aux courgettes"
 * sont deux entrées distinctes dans la liste de l'user.
 */
export async function toggleSheetOnActiveList(
  userId: string,
  sheet: {
    sheetId: string;
    recipeSlug: string;
    sheetTitle: string;
    coverUrl: string | null;
    servings: number;
    ingredients: RecipeIngredient[];
  },
  householdSize: number,
  /** Si l'utilisatrice a modifié le nb de portions sur la fiche AVANT
   *  d'ajouter à sa liste, on utilise CE nombre comme cible. Sinon
   *  on retombe sur householdSize (taille du foyer). */
  portionsOverride?: number,
): Promise<ShoppingListV2> {
  const list = await getOrCreateActiveList(userId);
  const isLinked = list.linkedRecipes.some((r) => r.sheetId === sheet.sheetId);

  let nextItems: ShoppingListV2Item[];
  let nextLinkedRecipes: ShoppingListLinkedRecipe[];
  if (isLinked) {
    nextItems = removeContributionsFromSource(list.items, (s) =>
      s.type === 'sheet' && s.sheetId === sheet.sheetId,
    );
    nextLinkedRecipes = list.linkedRecipes.filter((r) => r.sheetId !== sheet.sheetId);
  } else {
    const targetPortions =
      typeof portionsOverride === 'number' &&
      Number.isFinite(portionsOverride) &&
      portionsOverride > 0
        ? portionsOverride
        : householdSize;
    const ratio = targetPortions / Math.max(1, sheet.servings);
    const source: ShoppingItemSource = {
      type: 'sheet',
      sheetId: sheet.sheetId,
      recipeSlug: sheet.recipeSlug,
      sheetTitle: sheet.sheetTitle,
    };
    nextItems = mergeIngredients(list.items, sheet.ingredients, source, ratio);
    nextLinkedRecipes = [
      ...list.linkedRecipes,
      {
        sheetId: sheet.sheetId,
        recipeSlug: sheet.recipeSlug,
        sheetTitle: sheet.sheetTitle,
        sheetCoverUrl: sheet.coverUrl,
        addedAt: new Date().toISOString(),
      },
    ];
  }
  return saveListState(list.id, { items: nextItems, linkedRecipes: nextLinkedRecipes });
}

/**
 * Ajoute (ou retire) un menu hebdomadaire à la liste active (toggle).
 * Idem que pour les recettes mais source = 'menu'.
 */
export async function toggleMenuOnActiveList(
  userId: string,
  menu: {
    id: string;
    title: string | null;
    portions: number;
    items: ShoppingListItem[];
  },
  householdSize: number,
): Promise<ShoppingListV2> {
  const list = await getOrCreateActiveList(userId);
  const isLinked = list.linkedMenuId === menu.id;

  let nextItems: ShoppingListV2Item[];
  let nextLinkedMenuId: string | null;
  if (isLinked) {
    nextItems = removeContributionsFromSource(list.items, (s) =>
      s.type === 'menu' && s.menuId === menu.id,
    );
    nextLinkedMenuId = null;
  } else {
    const ratio = householdSize / Math.max(1, menu.portions);
    const source: ShoppingItemSource = {
      type: 'menu',
      menuId: menu.id,
      menuTitle: menu.title,
    };
    // ShoppingListItem (menu) → on adapte au format RecipeIngredient
    const asIngredients: RecipeIngredient[] = menu.items.map((it) => ({
      category: it.category,
      label: it.label,
      quantity: it.quantity,
      unit: it.unit,
      note: it.note ?? null,
    }));
    nextItems = mergeIngredients(list.items, asIngredients, source, ratio);
    nextLinkedMenuId = menu.id;
  }
  return saveListState(list.id, { items: nextItems, linkedMenuId: nextLinkedMenuId });
}

/** Ajoute un article manuel. Si la clé existe déjà : on additionne la qté
 *  (ou on ignore si sans qté). */
export async function addManualItem(
  userId: string,
  input: {
    category: string;
    label: string;
    quantity: number | null;
    unit: string | null;
    note: string | null;
  },
): Promise<ShoppingListV2> {
  const list = await getOrCreateActiveList(userId);
  const source: ShoppingItemSource = { type: 'manual' };
  const nextItems = mergeIngredients(
    list.items,
    [
      {
        category: input.category,
        label: input.label,
        quantity: input.quantity,
        unit: input.unit,
        note: input.note,
      },
    ],
    source,
    1,
  );
  return saveListState(list.id, { items: nextItems });
}

/**
 * Modifie manuellement la quantité d'un item.
 * Comportement : on REMPLACE les contributions par une unique
 * contribution 'manual' avec la nouvelle qté. La traçabilité multi-recette
 * est perdue (acceptable : c'est l'utilisatrice qui prend le contrôle).
 */
export async function setItemQuantity(
  userId: string,
  itemKey: string,
  newQuantity: number | null,
): Promise<ShoppingListV2> {
  const list = await getOrCreateActiveList(userId);
  const nextItems = list.items.map((it) =>
    it.key !== itemKey
      ? it
      : {
          ...it,
          totalQuantity: newQuantity,
          contributions: [
            { source: { type: 'manual' as const }, quantity: newQuantity },
          ],
        },
  );
  return saveListState(list.id, { items: nextItems });
}

/** Toggle l'état coché d'un item (par sa clé). */
export async function toggleItemChecked(
  userId: string,
  itemKey: string,
): Promise<ShoppingListV2> {
  const list = await getOrCreateActiveList(userId);
  const nextItems = list.items.map((it) =>
    it.key === itemKey ? { ...it, checked: !it.checked } : it,
  );
  return saveListState(list.id, { items: nextItems });
}

/** Supprime un item (toutes contributions confondues) de la liste active. */
export async function removeItem(
  userId: string,
  itemKey: string,
): Promise<ShoppingListV2> {
  const list = await getOrCreateActiveList(userId);
  const nextItems = list.items.filter((it) => it.key !== itemKey);
  return saveListState(list.id, { items: nextItems });
}

/**
 * Archive la liste active sous son nom courant et en crée une nouvelle vide.
 */
export async function archiveActiveList(
  userId: string,
  finalName?: string,
): Promise<ShoppingListV2> {
  const list = await getOrCreateActiveList(userId);
  const supabase = await createClient();
  await (supabase as any)
    .from('shopping_lists')
    .update({
      status: 'archived',
      name: (finalName ?? list.name).trim() || list.name,
      archived_at: new Date().toISOString(),
    })
    .eq('id', list.id)
    .eq('user_id', userId);
  // Crée une nouvelle liste active vide
  return getOrCreateActiveList(userId);
}

/** Renomme la liste active. */
export async function renameActiveList(
  userId: string,
  name: string,
): Promise<ShoppingListV2> {
  const list = await getOrCreateActiveList(userId);
  return saveListState(list.id, { name: name.trim() || list.name });
}

// ============================================================
// Helpers internes
// ============================================================

/** Format par défaut du nom : "Semaine du LU au DI" (dates de la semaine courante). */
export function defaultListName(now: Date): string {
  const day = now.getDay(); // 0=dim, 1=lun, ..., 6=sam
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + offsetToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `Semaine du ${fmt(monday)} au ${fmt(sunday)}`;
}

/**
 * Détecte les "consommables de placard" : ingrédients que l'utilisatrice
 * achète à la bouteille / au pot / au paquet, et dont la quantité dans
 * une recette n'a pas de sens pour la liste de courses.
 *
 * Règle (approche A, validée 2026-06-03) :
 *   - Si l'unité est une PETITE mesure (cs, cc, cuillère à soupe/café,
 *     pincée) → c'est un condiment, donc pantry.
 *   - Si le label contient un mot-clé de consommable (huile, sel, sucre,
 *     épices, herbes, etc.) → pantry.
 *
 * Pour ces items, on force `quantity = null` au merge dans la liste de
 * courses : "Huile d'olive" plutôt que "2 cs d'huile d'olive".
 */
function isPantryItem(ing: RecipeIngredient): boolean {
  if (ing.unit) {
    const u = ing.unit
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
    if (
      /^cs\b/.test(u) ||
      /^cc\b/.test(u) ||
      /^c\.?\s*a\.?\s*[sc]/.test(u) || // c.à.s / c. a c
      /^cuiller/.test(u) ||
      /^pinc/.test(u)
    ) {
      return true;
    }
  }
  const l = ing.label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const PANTRY_KEYWORDS = [
    'huile', 'vinaigre', 'sel', 'poivre', 'moutarde',
    'herbe', 'epice', 'paprika', 'curry', 'cumin', 'cannelle',
    'muscade', 'gingembre', 'curcuma', 'thym', 'romarin',
    'basilic', 'origan', 'persil', 'aneth', 'estragon',
    'farine', 'sucre', 'levure', 'bicarbonate',
    'miel', 'sirop', 'ketchup', 'sauce soja', 'sauce tomate',
  ];
  return PANTRY_KEYWORDS.some((k) => l.includes(k));
}

/**
 * Fusionne `incoming` ingrédients dans `existing` items, avec dédup et
 * addition des quantités. Multiplie chaque qty par `ratio` avant addition.
 *
 * Les "consommables de placard" (huile, sel, épices…) ont leur quantité
 * forcée à null pour s'aligner sur la réalité courses : on achète une
 * bouteille d'huile, pas 2 cuillerées.
 */
function mergeIngredients(
  existing: ShoppingListV2Item[],
  incoming: RecipeIngredient[],
  source: ShoppingItemSource,
  ratio: number,
): ShoppingListV2Item[] {
  // Index par clé pour mutation rapide
  const byKey = new Map<string, ShoppingListV2Item>(
    existing.map((it) => [it.key, { ...it, contributions: [...it.contributions] }]),
  );

  for (const ing of incoming) {
    const key = itemDedupKey(ing.category, ing.label);
    const pantry = isPantryItem(ing);
    const scaledQty = pantry
      ? null
      : typeof ing.quantity === 'number' && Number.isFinite(ing.quantity)
        ? ing.quantity * ratio
        : null;
    const existingItem = byKey.get(key);

    if (existingItem) {
      // Item existant — on ajoute une contribution
      // Pour les items SANS quantité : si déjà présent peu importe la source,
      // on n'ajoute PAS de nouvelle contribution (règle Didier 2026-06-03).
      if (scaledQty === null && existingItem.totalQuantity === null) {
        continue;
      }
      const newContribution: ShoppingItemContribution = {
        source,
        quantity: scaledQty,
      };
      existingItem.contributions.push(newContribution);
      existingItem.totalQuantity = sumContributions(existingItem.contributions);
    } else {
      // Item nouveau. Pour les pantry on retire aussi l'unité (sinon
      // on aurait "Huile d'olive (cs)" sans qty, ça n'a pas de sens).
      const newItem: ShoppingListV2Item = {
        key,
        category: ing.category,
        label: ing.label,
        unit: pantry ? null : ing.unit,
        note: ing.note,
        totalQuantity: scaledQty,
        checked: false,
        contributions: [{ source, quantity: scaledQty }],
      };
      byKey.set(key, newItem);
    }
  }

  return Array.from(byKey.values());
}

/**
 * Retire les contributions d'une source (filter sur le predicate) de tous
 * les items. Les items qui n'ont plus aucune contribution sont supprimés.
 * Les totalQuantity sont recalculées.
 */
function removeContributionsFromSource(
  items: ShoppingListV2Item[],
  matchSource: (source: ShoppingItemSource) => boolean,
): ShoppingListV2Item[] {
  const out: ShoppingListV2Item[] = [];
  for (const item of items) {
    const remaining = item.contributions.filter((c) => !matchSource(c.source));
    if (remaining.length === 0) continue;
    out.push({
      ...item,
      contributions: remaining,
      totalQuantity: sumContributions(remaining),
    });
  }
  return out;
}

/** Somme des quantités des contributions. null si toutes les contributions
 *  ont quantity=null (item sans qté à l'origine). */
function sumContributions(contributions: ShoppingItemContribution[]): number | null {
  let hasQty = false;
  let total = 0;
  for (const c of contributions) {
    if (typeof c.quantity === 'number' && Number.isFinite(c.quantity)) {
      hasQty = true;
      total += c.quantity;
    }
  }
  return hasQty ? total : null;
}

async function saveListState(
  listId: string,
  patch: {
    items?: ShoppingListV2Item[];
    linkedRecipes?: ShoppingListLinkedRecipe[];
    linkedMenuId?: string | null;
    name?: string;
  },
): Promise<ShoppingListV2> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatePayload: Record<string, any> = {};
  if (patch.items !== undefined) updatePayload.items = patch.items;
  if (patch.linkedRecipes !== undefined) updatePayload.linked_recipes = patch.linkedRecipes;
  if (patch.linkedMenuId !== undefined) updatePayload.linked_menu_id = patch.linkedMenuId;
  if (patch.name !== undefined) updatePayload.name = patch.name;
  const { data, error } = await (supabase as any)
    .from('shopping_lists')
    .update(updatePayload)
    .eq('id', listId)
    .select()
    .single();
  if (error) throw error;
  return rowToList(data);
}

function rowToList(row: any): ShoppingListV2 {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    linkedMenuId: row.linked_menu_id ?? null,
    linkedRecipes: Array.isArray(row.linked_recipes) ? row.linked_recipes : [],
    items: Array.isArray(row.items) ? row.items : [],
    createdAt: row.created_at,
    archivedAt: row.archived_at ?? null,
    updatedAt: row.updated_at,
  };
}
