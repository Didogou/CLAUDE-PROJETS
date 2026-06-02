import { getAllFeaturedPhotosForAdmin } from '@/lib/featured-photos';
import { FeaturedPhotosView } from '@/components/admin/FeaturedPhotosView';

export const dynamic = 'force-dynamic';

export default async function AdminSaviezVousPage() {
  const photos = await getAllFeaturedPhotosForAdmin();

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Contenu home
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">
          Le saviez-vous&nbsp;?
        </h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Polaroids affich&eacute;s sur l&apos;accueil. Uploade une image, ajoute
          un titre court (l&eacute;gende), publie ou cache. Les modifications
          sont visibles imm&eacute;diatement sur la home.
        </p>
      </header>

      <FeaturedPhotosView initial={photos} />
    </div>
  );
}
