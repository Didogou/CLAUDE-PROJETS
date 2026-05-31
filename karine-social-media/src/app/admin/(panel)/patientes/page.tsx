import { getActivePatients, getPendingPatientRequests } from '@/lib/patients';
import { PatientesView } from '@/components/admin/PatientesView';

export const dynamic = 'force-dynamic';

export default async function AdminPatientesPage() {
  const [requests, actives] = await Promise.all([
    getPendingPatientRequests(),
    getActivePatients(),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Acc&egrave;s gratuits
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">Patientes</h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Demandes d&apos;acc&egrave;s en attente et patientes valid&eacute;es avec leur
          &eacute;ch&eacute;ance (6 semaines depuis l&apos;approbation).
        </p>
      </header>

      <PatientesView requests={requests} actives={actives} />
    </div>
  );
}
