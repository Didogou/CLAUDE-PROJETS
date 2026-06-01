import {
  getActivePatients,
  getPendingPatientRequests,
  getRejectedPatientRequests,
} from '@/lib/patients';
import { PatientesView } from '@/components/admin/PatientesView';

export const dynamic = 'force-dynamic';

export default async function AdminPatientesPage() {
  const [requests, rejected, actives] = await Promise.all([
    getPendingPatientRequests(),
    getRejectedPatientRequests(),
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
          Demandes en attente, patientes valid&eacute;es (6 sem.) et demandes
          refus&eacute;es (Karine peut revenir sur sa d&eacute;cision).
        </p>
      </header>

      <PatientesView
        requests={requests}
        rejected={rejected}
        actives={actives}
      />
    </div>
  );
}
