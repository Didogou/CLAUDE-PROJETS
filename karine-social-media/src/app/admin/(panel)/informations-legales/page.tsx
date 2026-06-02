import { getLegalSettingsForAdmin } from '@/lib/legal-settings';
import { LegalSettingsView } from '@/components/admin/LegalSettingsView';

export const dynamic = 'force-dynamic';

export default async function AdminInformationsLegalesPage() {
  const settings = await getLegalSettingsForAdmin();

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Conformit&eacute;
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">
          Informations l&eacute;gales
        </h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Ces informations sont affich&eacute;es dans les pages{' '}
          <strong>Mentions l&eacute;gales</strong>, <strong>CGU</strong>,
          <strong> CGV</strong> et <strong>Confidentialit&eacute;</strong>.
          Tant qu&apos;un champ est vide, un badge rose &laquo;&nbsp;[NOM]&nbsp;&raquo;
          s&apos;affiche &agrave; la place dans les pages publiques.
        </p>
        <p className="mt-1 text-xs text-admin-ink-soft">
          Les coordonn&eacute;es bancaires en bas de page sont r&eacute;serv&eacute;es
          &agrave; l&apos;admin (jamais expos&eacute;es aux utilisatrices).
        </p>
      </header>

      <LegalSettingsView initial={settings} />
    </div>
  );
}
