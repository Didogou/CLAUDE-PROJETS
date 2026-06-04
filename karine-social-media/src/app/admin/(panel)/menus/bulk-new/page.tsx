import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { MenuBulkImporter } from '@/components/admin/MenuBulkImporter';

export const dynamic = 'force-dynamic';

/**
 * Page d'import rapide d'un menu de la semaine.
 *
 * Workflow :
 *   1. Karine saisit la date du lundi + titre optionnel
 *   2. Drop l'image cover + l'image de la liste de courses
 *   3. Drop 14 images de fiches recettes dans l'ordre Lundi déj,
 *      Lundi dîner, ..., Dimanche dîner
 *   4. Claude Vision extrait pour chaque fiche : titre, ingrédients,
 *      kcal, macros (prot/lipides/glucides par portion), servings,
 *      temps
 *   5. Tableau de relecture éditable + drag-drop pour réordonner
 *   6. "Tout enregistrer" → 14 sheets persistées en BDD
 *
 * Toutes les APIs et la table menu_meal_sheets existent déjà — cette
 * page n'est qu'un wrapper UI pour accélérer la création.
 */
export default function MenuBulkNewPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/menus"
          aria-label="Retour aux menus"
          className="grid h-10 w-10 place-items-center rounded-full bg-admin-surface text-admin-ink-soft transition hover:bg-admin-soft/50"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
            Création rapide
          </p>
          <h2 className="font-script text-3xl text-admin-primary-dark">
            Import en bulk
          </h2>
          <p className="mt-0.5 text-xs text-admin-ink-soft">
            Charge ta photo principale, ta liste de courses, puis tes 14
            fiches recettes d&apos;un coup. Vision extrait tout, tu valides.
          </p>
        </header>
      </div>

      <MenuBulkImporter />
    </div>
  );
}
