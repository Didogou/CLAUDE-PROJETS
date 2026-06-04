import { redirect } from 'next/navigation';

/**
 * Ancienne page de création manuelle d'un menu (formulaire 1-par-1).
 *
 * Décision Karine 2026-06-04 : la création passe uniquement par
 * l'import rapide (Vision extrait tout depuis 14 fiches recettes).
 * On redirige donc systématiquement vers /admin/menus/bulk-new.
 *
 * On garde MenuForm + l'ensemble de ses sous-éditeurs (MealSheetEditor,
 * ShoppingListEditor, PrepPhotosRow…) car ils restent utilisés pour
 * l'ÉDITION d'un menu existant — /admin/menus/[id] est inchangé.
 */
export default function NewMenuPage() {
  redirect('/admin/menus/bulk-new');
}
