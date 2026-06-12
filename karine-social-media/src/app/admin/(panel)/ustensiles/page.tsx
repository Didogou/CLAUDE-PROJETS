import { getAllUtensils } from '@/lib/utensils';
import { UtensilsCatalogView } from '@/components/admin/UtensilsCatalogView';

export const dynamic = 'force-dynamic';

export default async function AdminUtensilsPage() {
  const utensils = await getAllUtensils();
  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Catalogue
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">Ustensiles</h2>
        <p className="mt-1 max-w-2xl text-sm text-admin-ink-soft">
          Catalogue auto-alimenté par l&apos;extraction Vision des fiches
          (préparation). Renomme un libellé, associe une image, ou supprime
          les doublons. Le <em>slug</em> (clé référencée par les fiches) ne
          change pas.
        </p>
      </header>
      <UtensilsCatalogView initial={utensils} />
    </div>
  );
}
