import { getIdeasForAdmin } from '@/lib/ideas';
import { AdminIdeasView } from '@/components/admin/AdminIdeasView';

export const dynamic = 'force-dynamic';

export default async function AdminIdeesPage() {
  const [nouvelles, repondues] = await Promise.all([
    getIdeasForAdmin('new'),
    getIdeasForAdmin('replied'),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Communauté
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">Idées</h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Propositions de recettes, astuces et questions de tes abonnées.
          Réponds depuis cet écran : l’utilisatrice reçoit un email + une
          notification dans l’app.
        </p>
      </header>

      <AdminIdeasView nouvelles={nouvelles} repondues={repondues} />
    </div>
  );
}
