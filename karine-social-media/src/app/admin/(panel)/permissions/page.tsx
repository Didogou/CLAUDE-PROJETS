import { getAllCapabilities } from '@/lib/capabilities';
import { CapabilitiesView } from '@/components/admin/CapabilitiesView';

export const dynamic = 'force-dynamic';

export default async function AdminPermissionsPage() {
  const capabilities = await getAllCapabilities();

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Acc&egrave;s
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">
          Permissions
        </h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Choisissez ce qu&apos;une visiteuse <b>sans abonnement</b> peut faire.
          Les abonn&eacute;es, patientes et admin ont toujours acc&egrave;s
          &agrave; tout.
        </p>
      </header>

      <div className="rounded-2xl border border-admin-primary/20 bg-admin-soft/30 p-4 text-sm text-admin-ink-soft">
        <p className="font-semibold text-admin-ink">Comment &ccedil;a marche</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <b>Coch&eacute;</b> = ouvert &agrave; tout le monde, m&ecirc;me
            sans plan.
          </li>
          <li>
            <b>D&eacute;coch&eacute;</b> = r&eacute;serv&eacute; aux abonn&eacute;es
            et patientes. La visiteuse est redirig&eacute;e vers la page des
            abonnements.
          </li>
          <li>
            La sauvegarde est automatique &agrave; chaque clic.
          </li>
        </ul>
      </div>

      <CapabilitiesView initial={capabilities} />
    </div>
  );
}
