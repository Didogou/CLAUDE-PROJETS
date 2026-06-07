import { CiqualAliasesConflictView } from '@/components/admin/CiqualAliasesConflictView';

export const dynamic = 'force-dynamic';

export default function AdminCiqualAliasesPage() {
  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          R&eacute;f&eacute;rence nutritionnelle
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">
          Aliases Ciqual &mdash; r&eacute;solution des conflits
        </h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Chaque alias (expression naturelle) pointant vers <strong>plusieurs</strong>{' '}
          entr&eacute;es Ciqual est consid&eacute;r&eacute; comme un{' '}
          <strong>conflit</strong>. Choisis l&apos;aliment qui correspond le mieux
          &agrave; l&apos;alias, ou supprime-le s&apos;il est ambigu / faux.
        </p>
        <p className="mt-1 text-xs text-admin-ink-soft">
          Les aliases <em>resolved</em> participent &agrave; la recherche en
          prod. Les <em>rejected</em> sont d&eacute;finitivement &eacute;cart&eacute;s.
        </p>
      </header>

      <CiqualAliasesConflictView />
    </div>
  );
}
