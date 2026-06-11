import { TestsRunnerView } from '@/components/admin/TestsRunnerView';

export const dynamic = 'force-dynamic';

export default function AdminTestsPage() {
  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Qualité
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">
          Tests E2E
        </h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Lance la suite de tests automatiques Playwright et visualise les
          résultats. ⚠️ Marche uniquement en dev local (Vercel serverless ne
          peut pas spawner un navigateur).
        </p>
      </header>

      <TestsRunnerView />
    </div>
  );
}
