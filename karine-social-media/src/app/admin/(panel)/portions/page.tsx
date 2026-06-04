import { PortionsAdminView } from '@/components/admin/PortionsAdminView';

export const dynamic = 'force-dynamic';

export default async function AdminPortionsPage() {
  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          R&eacute;f&eacute;rentiel nutritionnel
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">
          Grille des portions
        </h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Tableau des portions standards par aliment + multiplicateurs
          d&apos;adjectifs (petit/grand/&eacute;norme) + questions de relance.
          Utilis&eacute; par Mistral pour estimer les portions quand
          l&apos;abonn&eacute;e tape sa saisie. Modifications appliqu&eacute;es
          imm&eacute;diatement (cache 5min).
        </p>
      </header>
      <PortionsAdminView />
    </div>
  );
}
