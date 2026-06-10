import { getAppSettings } from '@/lib/app-settings';
import { ParametresView } from '@/components/admin/ParametresView';
import { CleanupOrphansButton } from '@/components/admin/CleanupOrphansButton';

export const dynamic = 'force-dynamic';

export default async function AdminParametresPage() {
  const settings = await getAppSettings();

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Configuration
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">Param&egrave;tres</h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          R&eacute;glages globaux de l&apos;app. Effet imm&eacute;diat apr&egrave;s sauvegarde
          (pas de red&eacute;ploiement n&eacute;cessaire).
        </p>
      </header>

      <ParametresView initial={settings} />
      <CleanupOrphansButton />
    </div>
  );
}
