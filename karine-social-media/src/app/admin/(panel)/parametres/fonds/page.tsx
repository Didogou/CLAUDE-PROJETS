import { getBackgroundOverrides } from '@/lib/background-images';
import { BACKGROUND_VARIANTS } from '@/data/background-images';
import { BackgroundsView } from '@/components/admin/BackgroundsView';

export const dynamic = 'force-dynamic';

export default async function AdminBackgroundsPage() {
  const overrides = await getBackgroundOverrides();
  const rows = BACKGROUND_VARIANTS.map((v) => ({
    key: v.key,
    label: v.label,
    description: v.description,
    fallbackPortrait: v.fallbackPortrait,
    fallbackPaysage: v.fallbackPaysage,
    portraitUrl: overrides.get(v.key)?.portraitUrl ?? null,
    paysageUrl: overrides.get(v.key)?.paysageUrl ?? null,
  }));

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Param&egrave;tres
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">Fonds d&apos;&eacute;cran</h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Pour chaque section, uploade un fond <b>portrait</b> (mobile) et un fond{' '}
          <b>paysage</b> (tablette/PC). Tu vois en m&ecirc;me temps le fond actuel utilis&eacute;.
        </p>
        <p className="mt-1 text-xs text-admin-ink-soft">
          Format : image (PNG, JPG, WebP). La conversion en WebP optimis&eacute; est
          automatique apr&egrave;s upload.
        </p>
      </header>

      <BackgroundsView rows={rows} />
    </div>
  );
}
