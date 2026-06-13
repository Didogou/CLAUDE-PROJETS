import { VisitorHomeChecklist } from '@/components/admin/tests/VisitorHomeChecklist';

export const dynamic = 'force-dynamic';

export default function VisitorHomeTestPage() {
  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Tests
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">
          Accès visiteur — Accueil
        </h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Checklist manuelle pour vérifier le comportement de la page
          d&apos;accueil et de tous ses liens depuis un compte non connecté.
          Cocher au fur et à mesure (état persisté localement, par navigateur).
          <br />
          <strong>Avant de tester</strong> : se déconnecter et ouvrir la home
          dans une fenêtre de navigation privée pour garantir l&apos;absence de
          cookie.
        </p>
      </header>

      <VisitorHomeChecklist />
    </div>
  );
}
